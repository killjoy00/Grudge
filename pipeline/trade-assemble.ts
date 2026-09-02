/**
 * Turn stored rows into trade-model inputs, and run the model.
 *
 * Pure: rows in, report out, no database and no I/O. That is the point --
 * lib/trade-queries.ts is `server-only` and cannot be imported by a test or a
 * script, so if the assembly lived there it could only ever be exercised by
 * loading the admin page in a browser. Here it can be asserted directly.
 *
 * The model itself (replacement levels, the exact lineup solver, the
 * mutual-benefit search) is in trade.ts and is not touched by this file.
 */
import {
  findTrades, replacementLevels, starterDemand, POSITIONS, MIN_WEEKS_DEFAULT,
  type PlayerSeason, type TradeSuggestion,
} from './trade.ts';
import { expandSlots } from './lineup.ts';

/** One player's season, as the database stores it. */
export interface ScoringRow {
  espn_player_id: number;
  full_name: string;
  default_position_id: number | null;
  eligible_slots: number[] | null;
  /** Text, because Postgres numerics arrive as strings. */
  total: string;
  games: number;
}

/** How often a position was actually started at a slot. */
export interface FillRow {
  lineup_slot_id: number;
  default_position_id: number;
  n: number;
}

/** Who is on whose roster right now. */
export interface RosterRow {
  espn_team_id: number;
  espn_player_id: number;
}

export interface TradeInputs {
  season: number;
  weeks: number;
  throughWeek: number;
  scoring: ScoringRow[];
  fills: FillRow[];
  latest: RosterRow[];
  /** Slot id -> how many of that slot a team starts. */
  capacity: Map<number, number>;
  teams: Map<number, string>;
  /** Narrow suggestions to one franchise, after the league-wide search. */
  teamId?: number | null;
}

export interface TradeReport {
  season: number;
  weeks: number;
  throughWeek: number;
  players: number;
  levels: { position: string; ppg: number; startedPerWeek: number }[];
  teams: Map<number, string>;
  suggestions: TradeSuggestion[];
}

export interface TradeRefusal {
  season: number;
  weeks: number;
  required: number;
}

export type TradeResult =
  | { ok: true; report: TradeReport }
  | { ok: false; refusal: TradeRefusal };

/**
 * Slot capacity from lineups people actually set: the most starters any one
 * team fielded at a slot in any week IS that slot's capacity. Derived rather
 * than read from `lineup_slots`, which nothing in the pipeline maintains.
 */
export function capacityFromStarters(
  rows: { week: number; espn_team_id: number; lineup_slot_id: number }[]
): Map<number, number> {
  const perTeamWeek = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.week}:${r.espn_team_id}:${r.lineup_slot_id}`;
    perTeamWeek.set(key, (perTeamWeek.get(key) ?? 0) + 1);
  }
  const cap = new Map<number, number>();
  for (const [key, n] of perTeamWeek) {
    const slot = Number(key.split(':')[2]);
    cap.set(slot, Math.max(cap.get(slot) ?? 0, n));
  }
  return cap;
}

export function buildTradeReport(input: TradeInputs): TradeResult {
  const { season, weeks, throughWeek, teamId = null } = input;
  if (weeks < MIN_WEEKS_DEFAULT) {
    return { ok: false, refusal: { season, weeks, required: MIN_WEEKS_DEFAULT } };
  }

  // A player with no eligible slots cannot be placed in any lineup, so he is
  // dropped rather than silently valued at zero and offered in a trade.
  const players: PlayerSeason[] = input.scoring
    .filter((r) => r.default_position_id !== null && (r.eligible_slots?.length ?? 0) > 0)
    .map((r) => ({
      playerId: r.espn_player_id,
      name: r.full_name,
      positionId: r.default_position_id ?? 0,
      eligible: r.eligible_slots ?? [],
      ppg: r.games > 0 ? Number(r.total) / r.games : 0,
      games: r.games,
    }));
  const byId = new Map(players.map((p) => [p.playerId, p]));

  // Which positions were ever seen filling each slot. This is what tells the
  // model that FLEX takes RB/WR/TE in this league without us asserting it.
  const slotElig = new Map<number, number[]>();
  const observedFill = new Map<number, Map<number, number>>();
  for (const f of input.fills) {
    const seen = slotElig.get(f.lineup_slot_id) ?? [];
    if (!seen.includes(f.default_position_id)) seen.push(f.default_position_id);
    slotElig.set(f.lineup_slot_id, seen);
    const counts = observedFill.get(f.lineup_slot_id) ?? new Map<number, number>();
    counts.set(f.default_position_id, (counts.get(f.default_position_id) ?? 0) + f.n);
    observedFill.set(f.lineup_slot_id, counts);
  }

  const rosters = new Map<number, PlayerSeason[]>();
  for (const row of input.latest) {
    const player = byId.get(row.espn_player_id);
    if (!player) continue;
    const list = rosters.get(row.espn_team_id) ?? [];
    list.push(player);
    rosters.set(row.espn_team_id, list);
  }

  const teamCount = input.teams.size || 10;
  const demand = starterDemand(input.capacity, slotElig, observedFill, teamCount);
  const levels = replacementLevels(players, demand);
  const suggestions = findTrades(rosters, levels, expandSlots(input.capacity), { limit: 60 })
    .filter((t) => teamId === null || t.teamA === teamId || t.teamB === teamId);

  return {
    ok: true,
    report: {
      season, weeks, throughWeek, players: players.length,
      levels: Object.entries(POSITIONS)
        .map(([id, position]) => ({
          position,
          ppg: levels.get(Number(id)) ?? 0,
          startedPerWeek: demand.get(Number(id)) ?? 0,
        }))
        .filter((l) => l.ppg > 0 || l.startedPerWeek > 0),
      teams: input.teams,
      suggestions,
    },
  };
}
