import 'server-only';

/**
 * Reads for the public trade tab.
 *
 * SQL and shaping only. The valuation model is pipeline/trade-value.ts and the
 * reconstruction is pipeline/trade-history.ts -- both pure, both tested. The
 * split is the same one the trade board uses and for the same reason: a
 * `server-only` module cannot be loaded by a test, so nothing with a judgement
 * in it belongs here.
 */
import { asPublic, asUser } from './db.ts';
import {
  valueTrade, seasonContext, franchiseTradeRecords,
  type SeasonRosterRow, type SeasonPlayerRow, type TradeValue,
  type FranchiseTradeRecord,
} from '../pipeline/trade-value.ts';

export type { TradeValue, FranchiseTradeRecord } from '../pipeline/trade-value.ts';

export interface TradeRow {
  season: number;
  trade_id: string;
  effective_week: number;
  team_a: number;
  team_b: number;
  accepted_at: string | null;
  espn_transaction_id: string | null;
  /** How the trade was established. See pipeline/trade-history.ts. */
  confidence: 'ledger' | 'reciprocal' | 'manual';
  /** Votes are accepted until this moment. Null on trades imported by hand. */
  voting_closes_at: string | null;
}

export interface TradePlayerRow {
  trade_id: string;
  espn_player_id: number;
  full_name: string | null;
  default_position_id: number | null;
  from_team_id: number;
  to_team_id: number;
}

export interface TradeCard {
  trade: TradeRow;
  teamNames: Record<number, string>;
  /** What each side received, in the order the page reads them out. */
  received: Record<number, TradePlayerRow[]>;
  value: TradeValue;
}

/**
 * Whether a trade is still open for votes.
 *
 * Deliberately NOT computed inside seasonTrades: that result is cached for an
 * hour, and a boolean baked at cache time would keep a closed trade open until
 * the entry expired. The closing timestamp is cacheable; the comparison is not.
 */
export function votingOpen(trade: Pick<TradeRow, 'voting_closes_at'>): boolean {
  return trade.voting_closes_at !== null && Date.parse(trade.voting_closes_at) > Date.now();
}

/** Seasons with at least one reconstructed trade, newest first. */
export async function tradeSeasons(): Promise<number[]> {
  const rows = await asPublic<{ season: number }>(
    'select distinct season from public.trades order by season desc'
  );
  return rows.map((r) => r.season);
}

async function tradesOf(season?: number): Promise<TradeRow[]> {
  const where = season === undefined ? '' : 'where season = $1';
  return asPublic<TradeRow>(
    `select season, trade_id, effective_week, team_a, team_b, accepted_at,
            espn_transaction_id, confidence, voting_closes_at
       from public.trades ${where}
      order by season desc, effective_week desc, trade_id`,
    season === undefined ? [] : [season]
  );
}

/**
 * Everything a season's trades are valued against.
 *
 * Only weeks whose results are in: a week loaded but not played would show up
 * as every acquisition scoring nothing, which reads as a verdict rather than
 * as an empty column.
 */
async function contextFor(season: number) {
  const [rosterRows, playerRows, teams] = await Promise.all([
    asPublic<{
      week: number; espn_team_id: number; espn_player_id: number;
      lineup_slot_id: number; is_starter: boolean; applied_points: string | null;
    }>(
      `select r.week, r.espn_team_id, r.espn_player_id, r.lineup_slot_id,
              r.is_starter, r.applied_points
         from public.roster_entries r
         join public.weeks w
           on w.season = r.season and w.week = r.week and w.results_complete
        where r.season = $1`,
      [season]
    ),
    asPublic<SeasonPlayerRow>(
      `select distinct p.espn_player_id, p.default_position_id, p.eligible_slots
         from public.players p
         join public.roster_entries r using (espn_player_id)
        where r.season = $1`,
      [season]
    ),
    asPublic<{ n: number }>(
      'select count(*)::int as n from public.teams where season = $1', [season]
    ),
  ]);

  const rows: SeasonRosterRow[] = rosterRows.map((r) => ({
    week: r.week, espn_team_id: r.espn_team_id, espn_player_id: r.espn_player_id,
    lineup_slot_id: r.lineup_slot_id, is_starter: r.is_starter,
    applied_points: Number(r.applied_points ?? 0),
  }));
  return seasonContext(rows, playerRows, teams[0]?.n || 10);
}

/** Value every trade in a season. Returns an empty map for a season with none. */
async function valueSeason(
  season: number, trades: TradeRow[]
): Promise<Map<string, TradeValue>> {
  const mine = trades.filter((t) => t.season === season);
  if (mine.length === 0) return new Map();

  const [ctx, players] = await Promise.all([
    contextFor(season),
    asPublic<{ trade_id: string; espn_player_id: number; from_team_id: number; to_team_id: number }>(
      `select trade_id, espn_player_id, from_team_id, to_team_id
         from public.trade_players where season = $1`,
      [season]
    ),
  ]);

  return new Map(mine.map((t) => [t.trade_id, valueTrade({
    effective_week: t.effective_week,
    team_a: t.team_a,
    team_b: t.team_b,
    moves: players.filter((p) => p.trade_id === t.trade_id),
    ...ctx,
  })]));
}

/** Every trade in a season, valued, newest first. */
export async function seasonTrades(season: number): Promise<TradeCard[]> {
  const trades = await tradesOf(season);
  if (trades.length === 0) return [];

  const [values, players, teams] = await Promise.all([
    valueSeason(season, trades),
    asPublic<TradePlayerRow>(
      `select tp.trade_id, tp.espn_player_id, p.full_name, p.default_position_id,
              tp.from_team_id, tp.to_team_id
         from public.trade_players tp
         left join public.players p using (espn_player_id)
        where tp.season = $1
        order by tp.trade_id, p.default_position_id nulls last, p.full_name`,
      [season]
    ),
    asPublic<{ espn_team_id: number; name: string }>(
      'select espn_team_id, name from public.teams where season = $1',
      [season]
    ),
  ]);

  const teamNames = Object.fromEntries(teams.map((t) => [t.espn_team_id, t.name]));
  return trades.map((trade) => {
    const mine = players.filter((p) => p.trade_id === trade.trade_id);
    return {
      trade,
      teamNames,
      received: {
        [trade.team_a]: mine.filter((p) => p.to_team_id === trade.team_a),
        [trade.team_b]: mine.filter((p) => p.to_team_id === trade.team_b),
      },
      value: values.get(trade.trade_id)!,
    };
  });
}

/**
 * All-time trade standing, folded together by franchise so a manager who has
 * been three different team names is still one row.
 *
 * This walks every season with a trade in it and values each one against that
 * season's rosters, which is why the page caches it: the underlying numbers
 * only move when the weekly pipeline runs.
 */
export async function allTimeTradeRecords(): Promise<FranchiseTradeRecord[]> {
  const trades = await tradesOf();
  if (trades.length === 0) return [];
  const seasons = [...new Set(trades.map((t) => t.season))];

  const [perSeason, franchises] = await Promise.all([
    Promise.all(seasons.map((s) => valueSeason(s, trades))),
    asPublic<{
      season: number; espn_team_id: number; franchise_key: string | null;
      current_name: string | null; team_name: string;
    }>(
      `select tf.season, tf.espn_team_id, tf.franchise_key, f.current_name, tf.team_name
         from public.team_franchise tf
         left join public.franchises f using (franchise_key)`
    ),
  ]);

  const values = new Map(perSeason.flatMap((m) => [...m]));
  const byTeam = new Map(franchises.map((f) => [`${f.season}:${f.espn_team_id}`, f]));
  const seasonOf = new Map(trades.map((t) => [t.trade_id, t.season]));

  return franchiseTradeRecords(
    trades.map((t) => ({ trade_id: t.trade_id, value: values.get(t.trade_id)! })),
    (season, teamId) => {
      const f = byTeam.get(`${season}:${teamId}`);
      if (!f?.franchise_key) return null;
      return { key: f.franchise_key, name: f.current_name ?? f.team_name };
    },
    (tradeId) => seasonOf.get(tradeId) ?? 0
  );
}

export interface VoteState {
  /** The team this member voted for, or null. */
  mine: number | null;
  /** Tally, visible only once you have voted. Empty otherwise. */
  tally: Record<number, number>;
}

/**
 * This member's votes and, for trades they have voted on, the league tally.
 *
 * The tally is hidden until you vote, which is a database policy and not a
 * decision made here -- an unvoted trade returns no other rows no matter what
 * this function asks for. The same rule the predictions page runs on: read the
 * room afterwards, not before.
 */
export async function tradeVotes(season: number): Promise<Record<string, VoteState>> {
  const [mine, tallies] = await asUser<Record<string, unknown>>((q) => [
    q(`select trade_id, voted_team_id
         from public.trade_votes
        where season = $1 and user_id = app.current_user_id()`, [season]),
    q(`select trade_id, voted_team_id, count(*)::int as n
         from public.trade_votes where season = $1
        group by trade_id, voted_team_id`, [season]),
  ]);

  const out: Record<string, VoteState> = {};
  const state = (id: string) => (out[id] ??= { mine: null, tally: {} });
  for (const row of mine as { trade_id: string; voted_team_id: number }[]) {
    state(row.trade_id).mine = row.voted_team_id;
  }
  for (const row of tallies as { trade_id: string; voted_team_id: number; n: number }[]) {
    state(row.trade_id).tally[row.voted_team_id] = row.n;
  }
  return out;
}
