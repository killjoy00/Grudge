/**
 * ESPN payloads -> database rows.
 *
 * Pure functions, no I/O: everything here is unit-testable against the archived
 * payloads in data/history/ and exploration/raw/, which is how the derived
 * numbers get checked against seven real seasons rather than asserted.
 */
import type { EspnLeague, EspnMatchup, EspnRosterEntry, ProGame } from './espn.ts';

/* Bench and IR. A slot is a STARTER iff its league count > 0 and it is not one
   of these -- derived from settings, never hardcoded, so a roster-settings
   change cannot silently corrupt optimal-lineup maths. */
export const BENCH_SLOT = 20;
export const IR_SLOT = 21;

export interface SeasonRow {
  season: number;
  league_name: string;
  team_count: number;
  regular_season_weeks: number;
  playoff_team_count: number;
  final_scoring_period: number;
  faab_budget: number | null;
  playoff_seeding_rule: string | null;
  settings_raw: unknown;
}

export interface TeamRow {
  season: number;
  espn_team_id: number;
  name: string;
  abbrev: string | null;
  logo_url: string | null;
  division_id: number;
  primary_owner_swid: string | null;
  waiver_rank: number | null;
  faab_spent: number;
}

export interface MatchupRow {
  season: number;
  espn_matchup_id: number;
  week: number;
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
  winner: 'HOME' | 'AWAY' | 'TIE' | 'UNDECIDED';
  playoff_tier: string | null;
  is_final: boolean;
}

export interface RosterEntryRow {
  season: number;
  week: number;
  espn_team_id: number;
  espn_player_id: number;
  lineup_slot_id: number;
  is_starter: boolean;
  applied_points: number | null;
  acquisition_type: string | null;
  injury_status: string | null;
}

export interface WeekRow {
  season: number;
  week: number;
  first_kickoff_at: string | null;
  last_kickoff_at: string | null;
  has_tbd_kickoff: boolean;
  is_playoff: boolean;
}

/** Slot ids that count as starters for this league, from its own settings. */
export function starterSlots(league: EspnLeague): Set<number> {
  const counts = league.settings?.rosterSettings?.lineupSlotCounts ?? {};
  const out = new Set<number>();
  for (const [id, n] of Object.entries(counts)) {
    const slot = Number(id);
    if (n > 0 && slot !== BENCH_SLOT && slot !== IR_SLOT) out.add(slot);
  }
  return out;
}

/**
 * How many players a legal lineup starts. NOT the same as starterSlots().size:
 * slots have multiplicities (this league starts RB x2 and WR x2), so 8 distinct
 * starter slots make a 10-player lineup. Optimal-lineup maths needs the count,
 * the slot set, and the per-slot capacity below -- conflating them silently
 * understates a team's ceiling.
 */
export function starterCount(league: EspnLeague): number {
  const counts = league.settings?.rosterSettings?.lineupSlotCounts ?? {};
  let total = 0;
  for (const [id, n] of Object.entries(counts)) {
    const slot = Number(id);
    if (n > 0 && slot !== BENCH_SLOT && slot !== IR_SLOT) total += n;
  }
  return total;
}

/** Starter slot id -> how many of that slot the league starts. */
export function starterSlotCounts(league: EspnLeague): Map<number, number> {
  const counts = league.settings?.rosterSettings?.lineupSlotCounts ?? {};
  const out = new Map<number, number>();
  for (const [id, n] of Object.entries(counts)) {
    const slot = Number(id);
    if (n > 0 && slot !== BENCH_SLOT && slot !== IR_SLOT) out.set(slot, n);
  }
  return out;
}

export function seasonRow(league: EspnLeague): SeasonRow {
  const s = league.settings;
  if (!s) throw new Error('league payload has no settings');
  return {
    season: league.seasonId,
    league_name: s.name,
    team_count: s.size,
    regular_season_weeks: s.scheduleSettings.matchupPeriodCount,
    playoff_team_count: s.scheduleSettings.playoffTeamCount,
    final_scoring_period: finalScoringPeriod(league),
    faab_budget: s.acquisitionSettings?.acquisitionBudget ?? null,
    playoff_seeding_rule: s.scheduleSettings.playoffSeedingRule ?? null,
    settings_raw: s,
  };
}

/** Highest scoring period the league's own matchupPeriods map mentions. */
export function finalScoringPeriod(league: EspnLeague): number {
  const periods = league.settings?.scheduleSettings?.matchupPeriods ?? {};
  let max = 0;
  for (const list of Object.values(periods)) for (const p of list) max = Math.max(max, p);
  return max || 17;
}

export function teamRows(league: EspnLeague): TeamRow[] {
  return (league.teams ?? []).map((t) => ({
    season: league.seasonId,
    espn_team_id: t.id,
    name: t.name,
    abbrev: t.abbrev ?? null,
    logo_url: t.logo ?? null,
    division_id: t.divisionId ?? 0,
    primary_owner_swid: t.primaryOwner ?? null,
    waiver_rank: t.waiverRank ?? null,
    faab_spent: t.transactionCounter?.acquisitionBudgetSpent ?? 0,
  }));
}

function decideWinner(m: EspnMatchup): MatchupRow['winner'] {
  const w = (m.winner ?? 'UNDECIDED').toUpperCase();
  return w === 'HOME' || w === 'AWAY' || w === 'TIE' ? w : 'UNDECIDED';
}

export function matchupRows(league: EspnLeague): MatchupRow[] {
  const out: MatchupRow[] = [];
  for (const m of league.schedule ?? []) {
    // Every matchup in this league has both sides; guard anyway so a bye or a
    // partially-generated playoff bracket is skipped rather than crashing.
    if (!m.home || !m.away) continue;
    const winner = decideWinner(m);
    out.push({
      season: league.seasonId,
      espn_matchup_id: m.id,
      week: m.matchupPeriodId,
      home_team_id: m.home.teamId,
      away_team_id: m.away.teamId,
      home_points: m.home.totalPoints ?? null,
      away_points: m.away.totalPoints ?? null,
      winner,
      playoff_tier: m.playoffTierType ?? null,
      is_final: winner !== 'UNDECIDED',
    });
  }
  return out;
}

/** Weekly lineup rows from an mBoxscore payload for one scoring period. */
export function rosterEntryRows(
  boxscore: EspnLeague,
  week: number,
  starters: Set<number>
): RosterEntryRow[] {
  const out: RosterEntryRow[] = [];
  const push = (teamId: number, entries: EspnRosterEntry[]) => {
    for (const e of entries) {
      out.push({
        season: boxscore.seasonId,
        week,
        espn_team_id: teamId,
        espn_player_id: e.playerId,
        lineup_slot_id: e.lineupSlotId,
        is_starter: starters.has(e.lineupSlotId),
        applied_points: e.playerPoolEntry?.appliedStatTotal ?? null,
        acquisition_type: e.acquisitionType ?? null,
        injury_status: e.injuryStatus ?? null,
      });
    }
  };
  for (const m of boxscore.schedule ?? []) {
    if (m.matchupPeriodId !== week) continue;
    if (m.home) push(m.home.teamId, m.home.rosterForCurrentScoringPeriod?.entries ?? []);
    if (m.away) push(m.away.teamId, m.away.rosterForCurrentScoringPeriod?.entries ?? []);
  }
  return out;
}

/** Players seen anywhere in a boxscore, for the shared `players` table. */
export function playerRows(boxscore: EspnLeague) {
  const byId = new Map<number, { espn_player_id: number; full_name: string; default_position_id: number | null; pro_team_id: number | null }>();
  for (const m of boxscore.schedule ?? []) {
    for (const side of [m.home, m.away]) {
      for (const e of side?.rosterForCurrentScoringPeriod?.entries ?? []) {
        const p = e.playerPoolEntry?.player;
        if (!p) continue;
        byId.set(p.id, {
          espn_player_id: p.id,
          full_name: p.fullName,
          default_position_id: p.defaultPositionId ?? null,
          pro_team_id: p.proTeamId ?? null,
        });
      }
    }
  }
  return [...byId.values()];
}

/**
 * Week rows with lock times.
 *
 * `has_tbd_kickoff` matters: weeks 16-17 carry flex-scheduled games with
 * startTimeTBD, so their first kickoff can still move and the lock time must be
 * refreshed every run rather than computed once in preseason.
 */
export function weekRows(season: number, games: ProGame[], regularSeasonWeeks: number): WeekRow[] {
  const byWeek = new Map<number, ProGame[]>();
  for (const g of games) {
    const list = byWeek.get(g.scoringPeriodId) ?? [];
    list.push(g);
    byWeek.set(g.scoringPeriodId, list);
  }
  const out: WeekRow[] = [];
  for (const [week, list] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...list].sort((a, b) => a.date - b.date);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) continue;
    out.push({
      season,
      week,
      first_kickoff_at: new Date(first.date).toISOString(),
      last_kickoff_at: new Date(last.date).toISOString(),
      has_tbd_kickoff: list.some((g) => g.startTimeTBD === true),
      is_playoff: week > regularSeasonWeeks,
    });
  }
  return out;
}

/* ------------------------------------------------------- completeness gate */

export interface Completeness {
  week: number;
  matchupsTotal: number;
  matchupsDecided: number;
  complete: boolean;
  reason?: string;
}

/**
 * Is a week finished? The pipeline refuses to write derived rows for a week
 * that is not, which is what stops a half-played Sunday being archived as
 * final and then never corrected.
 *
 * "Complete" means every matchup in the week has a real winner. A week with no
 * matchups at all is NOT complete -- that is an unplayed or ungenerated week
 * (e.g. the 2026 playoff bracket, which ESPN has not created yet), not a
 * finished one.
 */
export function weekCompleteness(league: EspnLeague, week: number): Completeness {
  const rows = matchupRows(league).filter((m) => m.week === week);
  const decided = rows.filter((m) => m.winner !== 'UNDECIDED').length;
  if (rows.length === 0) {
    return { week, matchupsTotal: 0, matchupsDecided: 0, complete: false, reason: 'no matchups scheduled for this week' };
  }
  if (decided < rows.length) {
    return {
      week,
      matchupsTotal: rows.length,
      matchupsDecided: decided,
      complete: false,
      reason: `${rows.length - decided} of ${rows.length} matchups still undecided`,
    };
  }
  return { week, matchupsTotal: rows.length, matchupsDecided: decided, complete: true };
}

/** Every week that has finished, in order. */
export function completedWeeks(league: EspnLeague): number[] {
  const weeks = new Set(matchupRows(league).map((m) => m.week));
  return [...weeks].sort((a, b) => a - b).filter((w) => weekCompleteness(league, w).complete);
}
