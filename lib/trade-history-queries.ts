import 'server-only';

/**
 * Reads for the public trade tab.
 *
 * SQL and shaping only. The grading model is pipeline/trade-grade.ts and the
 * reconstruction is pipeline/trade-history.ts -- both pure, both tested. The
 * split is the same one the trade board uses and for the same reason: a
 * `server-only` module cannot be loaded by a test, so nothing with a judgement
 * in it belongs here.
 */
import { asPublic, asUser } from './db.ts';
import {
  gradeTrade, franchiseTradeRecords,
  type AcquiredPoints, type GradedTrade, type FranchiseTradeRecord,
} from '../pipeline/trade-grade.ts';

export type { GradedTrade, FranchiseTradeRecord } from '../pipeline/trade-grade.ts';

export interface TradeRow {
  season: number;
  trade_id: string;
  effective_week: number;
  team_a: number;
  team_b: number;
  accepted_at: string | null;
  espn_transaction_id: string | null;
  /** How the trade was established. See pipeline/trade-history.ts. */
  confidence: 'ledger' | 'reciprocal';
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
  grade: GradedTrade;
}

/** Seasons with at least one reconstructed trade, newest first. */
export async function tradeSeasons(): Promise<number[]> {
  const rows = await asPublic<{ season: number }>(
    'select distinct season from public.trades order by season desc'
  );
  return rows.map((r) => r.season);
}

/**
 * Points each acquired player produced FOR THE TEAM THAT ACQUIRED HIM, from
 * the trade week onward.
 *
 * The join to roster_entries pins both the team and the week, which is what
 * makes "while rostered" fall out for free: a player dropped in week 8 simply
 * has no rows after week 7, and rows he earns on a third team belong to
 * nobody's side of this trade.
 */
async function acquiredPoints(season: number): Promise<AcquiredPoints[]> {
  const rows = await asPublic<{
    trade_id: string; espn_player_id: number; to_team_id: number;
    starter_points: string; total_points: string; weeks_rostered: number;
  }>(
    `select tp.trade_id, tp.espn_player_id, tp.to_team_id,
            coalesce(sum(re.applied_points) filter (where re.is_starter), 0)::text as starter_points,
            coalesce(sum(re.applied_points), 0)::text as total_points,
            count(re.week)::int as weeks_rostered
       from public.trade_players tp
       join public.trades t on t.season = tp.season and t.trade_id = tp.trade_id
       left join public.roster_entries re
         on re.season = tp.season
        and re.espn_player_id = tp.espn_player_id
        and re.espn_team_id = tp.to_team_id
        and re.week >= t.effective_week
        -- Only weeks whose results are in. A week loaded but not yet played
        -- would otherwise drag every acquisition toward zero and read as a
        -- verdict rather than as an empty column.
        and exists (
              select 1 from public.weeks w
               where w.season = re.season and w.week = re.week and w.results_complete
            )
      where tp.season = $1
      group by tp.trade_id, tp.espn_player_id, tp.to_team_id`,
    [season]
  );
  return rows.map((r) => ({
    trade_id: r.trade_id,
    espn_player_id: r.espn_player_id,
    to_team_id: r.to_team_id,
    starter_points: Number(r.starter_points),
    total_points: Number(r.total_points),
    weeks_rostered: r.weeks_rostered,
  }));
}

/** Every trade in a season, graded, newest first. */
export async function seasonTrades(season: number): Promise<TradeCard[]> {
  const [trades, players, teams, acquired] = await Promise.all([
    asPublic<TradeRow>(
      `select season, trade_id, effective_week, team_a, team_b,
              accepted_at, espn_transaction_id, confidence
         from public.trades where season = $1
        order by effective_week desc, trade_id`,
      [season]
    ),
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
    acquiredPoints(season),
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
      grade: gradeTrade(trade, acquired),
    };
  });
}

/**
 * All-time trade standing.
 *
 * Every season is graded and then folded together by franchise, so a manager
 * who has been three different team names is still one row. Seasons with no
 * trades cost nothing -- they return no rows to fold.
 */
export async function allTimeTradeRecords(): Promise<FranchiseTradeRecord[]> {
  const seasons = await tradeSeasons();
  if (seasons.length === 0) return [];

  const [trades, franchises, acquired] = await Promise.all([
    asPublic<TradeRow>(
      `select season, trade_id, effective_week, team_a, team_b,
              accepted_at, espn_transaction_id, confidence
         from public.trades`
    ),
    asPublic<{ season: number; espn_team_id: number; franchise_key: string | null; current_name: string | null; team_name: string }>(
      `select tf.season, tf.espn_team_id, tf.franchise_key, f.current_name, tf.team_name
         from public.team_franchise tf
         left join public.franchises f using (franchise_key)`
    ),
    Promise.all(seasons.map(acquiredPoints)).then((all) => all.flat()),
  ]);

  const seasonOf = new Map(trades.map((t) => [t.trade_id, t.season]));
  const byTeam = new Map(
    franchises.map((f) => [`${f.season}:${f.espn_team_id}`, f])
  );

  const graded = trades.map((t) => gradeTrade(t, acquired));
  return franchiseTradeRecords(
    graded,
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
