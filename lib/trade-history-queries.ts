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
import { publishedTrades, unpublishedTrade } from './published-trades.ts';
import {
  franchiseTradeRecords,
  type TradeValue,
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
    "select distinct season from public.trades where evidence_status = 'active' order by season desc"
  );
  return rows.map((r) => r.season);
}

async function tradesOf(season?: number): Promise<TradeRow[]> {
  const where = season === undefined ? "where evidence_status = 'active'" : "where evidence_status = 'active' and season = $1";
  return asPublic<TradeRow>(
    `select season, trade_id, effective_week, team_a, team_b, accepted_at,
            espn_transaction_id, confidence, voting_closes_at
       from public.trades ${where}
      order by season desc, effective_week desc, trade_id`,
    season === undefined ? [] : [season]
  );
}

/** Value every trade in a season. Returns an empty map for a season with none. */
async function valueSeason(
  season: number, trades: TradeRow[]
): Promise<Map<string, TradeValue>> {
  const mine = trades.filter((t) => t.season === season);
  if (mine.length === 0) return new Map();

  const published = new Map((await publishedTrades(season)).map((r) => [r.trade_id, r.fit]));
  return new Map(mine.map((t) => [t.trade_id,
    published.get(t.trade_id) ?? unpublishedTrade(t.team_a, t.team_b)]));
}

/** Every trade in a season, valued, newest first. */
export async function seasonTrades(season: number): Promise<TradeCard[]> {
  const trades = await tradesOf(season);
  if (trades.length === 0) return [];

  const [values, players, teams] = await Promise.all([
    valueSeason(season, trades),
    asPublic<TradePlayerRow>(
      `select tp.trade_id, tp.espn_player_id, coalesce(profile.full_name, p.full_name) as full_name,
              coalesce(profile.position_id, p.default_position_id) as default_position_id,
              tp.from_team_id, tp.to_team_id
         from public.trade_players tp
         left join public.players p using (espn_player_id)
         left join public.player_season_profiles profile
           on profile.season = tp.season and profile.espn_player_id = tp.espn_player_id
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
 * Reads immutable published results, then folds them by franchise. Historical
 * rosters and counterfactual lineups are computed only by the refresh pipeline.
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

  const values = new Map(perSeason.flatMap((m, i) => [...m].map(([id, value]) => [`${seasons[i]}:${id}`, value] as const)));
  const byTeam = new Map(franchises.map((f) => [`${f.season}:${f.espn_team_id}`, f]));
  const seasonOf = new Map(trades.map((t) => [`${t.season}:${t.trade_id}`, t.season]));

  return franchiseTradeRecords(
    trades.map((t) => ({ trade_id: `${t.season}:${t.trade_id}`, value: values.get(`${t.season}:${t.trade_id}`)! })),
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
