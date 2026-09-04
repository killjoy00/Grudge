/**
 * ESPN payloads -> database rows.
 *
 * Pure functions, no I/O: everything here is unit-testable against the archived
 * payloads in data/history/ and exploration/raw/, which is how the derived
 * numbers get checked against seven real seasons rather than asserted.
 */
import type {
  EspnDraftDetail, EspnLeague, EspnMatchup, EspnRosterEntry, ProGame,
} from './espn.ts';

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
  projected_points: number | null;
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

/**
 * What the player was expected to score that week.
 *
 * ESPN ships both numbers in the same stats array: statSourceId 0 is what
 * happened, 1 is the projection. Only the actual was ever read, which is why
 * projected_points sat null on every row -- and without it there is no way to
 * say a 30-point game was a surprise rather than a Tuesday.
 */
export function projectedPoints(entry: EspnRosterEntry, week: number): number | null {
  const stats = entry.playerPoolEntry?.player?.stats ?? [];
  const projection = stats.find(
    (stat) => stat.statSourceId === 1 && stat.scoringPeriodId === week
  );
  return projection?.appliedTotal ?? null;
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
        projected_points: projectedPoints(e, week),
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

export interface MatchupProjectionRow {
  season: number;
  week: number;
  espn_matchup_id: number;
  espn_team_id: number;
  projected_points: number;
  starters: number;
}

/**
 * What ESPN expects each side to score in a week that has NOT been played.
 *
 * ESPN publishes no win probability. It publishes a projection per player, and
 * its own matchup view shows the sum over the starting lineup -- so that sum
 * is ESPN's number, and the higher one is the side it is picking. Nothing is
 * modelled here; this is arithmetic on what ESPN served.
 *
 * A player with no projection contributes 0 and is still counted as a starter,
 * which is right: ESPN expecting nothing from a slot is a real prediction
 * about that team, not missing data. `starters` is returned so a lineup with
 * an actually empty slot can be told apart from a weak one.
 *
 * Bench and IR are excluded exactly as they are from a real score.
 */
export function matchupProjectionRows(
  boxscore: EspnLeague,
  week: number,
  starters: Set<number>
): MatchupProjectionRow[] {
  const out: MatchupProjectionRow[] = [];
  for (const m of boxscore.schedule ?? []) {
    if (m.matchupPeriodId !== week) continue;
    for (const side of [m.home, m.away]) {
      if (!side) continue;
      let points = 0;
      let count = 0;
      for (const e of side.rosterForCurrentScoringPeriod?.entries ?? []) {
        if (!starters.has(e.lineupSlotId)) continue;
        points += projectedPoints(e, week) ?? 0;
        count += 1;
      }
      // A side with nothing in its starting slots is not a 0.0 projection, it
      // is an absent lineup. Writing it as 0 would hand the other team a free
      // correct pick in ESPN's record.
      if (count === 0) continue;
      out.push({
        season: boxscore.seasonId,
        week,
        espn_matchup_id: m.id,
        espn_team_id: side.teamId,
        projected_points: Number(points.toFixed(2)),
        starters: count,
      });
    }
  }
  return out;
}

export interface DraftPickRow {
  season: number;
  overall_pick: number;
  round: number;
  round_pick: number;
  espn_team_id: number;
  espn_player_id: number;
  is_keeper: boolean;
}

/** The draft board, straight from mDraftDetail. */
export function draftPickRows(detail: EspnDraftDetail, season: number): DraftPickRow[] {
  // `drafted` false means the board is a placeholder ESPN generated before the
  // draft happened, with picks that name nobody. Loading it would fill the
  // table with team 0 / player 0 rows.
  if (!detail.draftDetail?.drafted) return [];
  return (detail.draftDetail.picks ?? [])
    // NEGATIVE ids are real. ESPN identifies a team defence with one (-16034
    // is a D/ST, not a corrupt row), so the test is "not zero", not
    // "positive". Filtering on `> 0` drops exactly ten picks from a sixteen
    // round draft -- every defence, one per team -- and does it silently.
    .filter((p) => p.playerId !== 0 && p.teamId > 0)
    .map((p) => ({
      season,
      overall_pick: p.overallPickNumber,
      round: p.roundId,
      round_pick: p.roundPickNumber,
      espn_team_id: p.teamId,
      espn_player_id: p.playerId,
      is_keeper: Boolean(p.keeper),
    }));
}

/** Players seen anywhere in a boxscore, for the shared `players` table. */
export function playerRows(boxscore: EspnLeague) {
  const byId = new Map<number, {
    espn_player_id: number; full_name: string;
    default_position_id: number | null; pro_team_id: number | null;
    eligible_slots: number[] | null;
  }>();
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
          // What this player may legally be started at. Kept as ESPN's own
          // slot ids: they are what the lineup solver matches against, and
          // decoding them here would mean maintaining a second copy of
          // ESPN's slot table.
          eligible_slots: p.eligibleSlots ?? null,
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

/* ------------------------------------------------ free agent pool (Step 8) */

/**
 * A player in the free-agent / waiver pool, as returned by kona_player_info.
 *
 * SCHEMA CONFIDENCE -- read before trusting `status`. The 25 players captured
 * in Step 1 ALL came back as "WAIVERS", every one with onTeamId 0. The filter
 * requests FREEAGENT as well and ESPN accepted it (HTTP 200), but that string
 * has never actually been seen in a response for this league, because the
 * capture was taken in the preseason when the whole pool sits on waivers.
 *
 * So `status` is passed through verbatim rather than being parsed into an
 * enum, and nothing downstream branches on it being one of a known set. If
 * ESPN returns something unexpected in September it lands in the column as-is
 * and shows up in the admin view, instead of being silently coerced.
 *
 * Player ids are legitimately NEGATIVE for D/ST units (-16017, -16005, -16012
 * were all observed), which is why the column is bigint and no `> 0` check
 * exists anywhere.
 */
export interface FreeAgentRow {
  espn_player_id: number;
  full_name: string;
  default_position_id: number | null;
  pro_team_id: number | null;
  percent_owned: number | null;
  percent_change: number | null;
  percent_started: number | null;
  auction_value_avg: number | null;
  avg_draft_position: number | null;
  status: string | null;
  on_team_id: number | null;
}

interface KonaPayload {
  players?: {
    id: number;
    status?: string;
    onTeamId?: number;
    player?: {
      fullName?: string;
      defaultPositionId?: number;
      proTeamId?: number;
      ownership?: {
        percentOwned?: number;
        percentChange?: number;
        percentStarted?: number;
        auctionValueAverage?: number;
        averageDraftPosition?: number;
      };
    };
  }[];
}

/** null rather than 0 for a missing number: "unknown" and "zero" differ here. */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function freeAgentRows(payload: unknown): FreeAgentRow[] {
  const players = (payload as KonaPayload)?.players ?? [];
  const byId = new Map<number, FreeAgentRow>();

  for (const entry of players) {
    const p = entry?.player;
    // A pool entry with no player object or no name is not something we can
    // key on or display; skipping beats inventing a placeholder row.
    if (!p?.fullName || typeof entry.id !== 'number') continue;
    const o = p.ownership ?? {};

    byId.set(entry.id, {
      espn_player_id: entry.id,
      full_name: p.fullName,
      default_position_id: num(p.defaultPositionId),
      pro_team_id: num(p.proTeamId),
      percent_owned: num(o.percentOwned),
      percent_change: num(o.percentChange),
      percent_started: num(o.percentStarted),
      auction_value_avg: num(o.auctionValueAverage),
      avg_draft_position: num(o.averageDraftPosition),
      status: entry.status ?? null,
      on_team_id: num(entry.onTeamId),
    });
  }

  // Deduplicated by id: ESPN has been observed to repeat an entry across
  // pages, and the snapshot table's primary key would reject the second copy
  // mid-transaction rather than at the boundary.
  return [...byId.values()];
}

/* ------------------------------------------------------------ transactions */

export interface TransactionRow {
  espn_transaction_id: string;
  season: number;
  week: number;
  espn_team_id: number | null;
  type: string;
  /** Null where ESPN sends none. See the note below -- this is not a defect. */
  status: string | null;
  execution_type: string | null;
  bid_amount: number;
  is_pending: boolean;
  proposed_at: string | null;
  raw: string;
}

/**
 * League transactions, for the weeks we know about.
 *
 * `status` is NULLABLE and that is the whole point. Every transaction in the
 * archive at design time was a DRAFT, and every DRAFT carries 'EXECUTED', so
 * the column was written not-null on the strength of a sample that happened to
 * be uniform. A TRADE_ACCEPT sends no status at all -- it carries
 * executionType 'EXECUTE', an empty items array, and a relatedTransactionId
 * pointing at the proposal, which is where the status actually lives. The
 * first accepted trade of the 2026 preseason failed the entire weekly run.
 *
 * Null records that ESPN did not say. Defaulting to 'EXECUTED' would assert
 * something ESPN never sent, on an envelope whose own semantics we are
 * inferring.
 *
 * A transaction with no `type` IS skipped: type is the discriminator, and a
 * row we cannot classify is worse than no row.
 */
export function transactionRows(
  league: EspnLeague, knownWeeks: Set<number>
): TransactionRow[] {
  const out: TransactionRow[] = [];
  for (const t of league.transactions ?? []) {
    if (!knownWeeks.has(t.scoringPeriodId)) continue;
    if (!t.type) continue;
    out.push({
      espn_transaction_id: t.id,
      season: league.seasonId,
      week: t.scoringPeriodId,
      espn_team_id: t.teamId ?? null,
      type: t.type,
      status: t.status ?? null,
      execution_type: t.executionType ?? null,
      bid_amount: t.bidAmount ?? 0,
      is_pending: t.isPending ?? false,
      proposed_at: t.proposedDate ? new Date(t.proposedDate).toISOString() : null,
      raw: JSON.stringify(t),
    });
  }
  return out;
}
