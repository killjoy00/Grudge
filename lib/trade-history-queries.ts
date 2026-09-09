import 'server-only';

/** Reads for the public trade tab. */
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
  confidence: 'ledger' | 'reciprocal' | 'manual';
  voting_closes_at: string | null;
}

export interface TradePlayerRow {
  trade_id: string;
  player_key: string;
  espn_player_id: number;
  full_name: string | null;
  default_position_id: number | null;
  from_team_id: number;
  to_team_id: number;
}

export interface TradeCard {
  trade: TradeRow;
  teamNames: Record<number, string>;
  teamFranchises: Record<number, string>;
  received: Record<number, TradePlayerRow[]>;
  value: TradeValue;
}

export function votingOpen(trade: Pick<TradeRow, 'voting_closes_at'>): boolean {
  return trade.voting_closes_at !== null && Date.parse(trade.voting_closes_at) > Date.now();
}

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

async function valueSeason(season: number, trades: TradeRow[]): Promise<Map<string, TradeValue>> {
  const mine = trades.filter((t) => t.season === season);
  if (mine.length === 0) return new Map();
  const published = new Map((await publishedTrades(season)).map((r) => [r.trade_id, r.fit]));
  return new Map(mine.map((t) => [t.trade_id,
    published.get(t.trade_id) ?? unpublishedTrade(t.team_a, t.team_b)]));
}

export async function seasonTrades(season: number): Promise<TradeCard[]> {
  const trades = await tradesOf(season);
  if (trades.length === 0) return [];

  const [values, players, teams] = await Promise.all([
    valueSeason(season, trades),
    asPublic<TradePlayerRow>(
      `select tp.trade_id, tp.player_key, tp.espn_player_id, np.full_name,
              pi.position_id as default_position_id, tp.from_team_id, tp.to_team_id
         from public.trade_players tp
         join public.nfl_players np on np.player_key = tp.player_key
         left join public.player_identity pi
           on pi.season = tp.season and pi.espn_player_id = tp.espn_player_id
          and pi.player_key = tp.player_key
        where tp.season = $1
        order by tp.trade_id, pi.position_id nulls last, np.full_name`,
      [season]
    ),
    asPublic<{ espn_team_id: number; name: string; franchise_key: string | null }>(
      `select t.espn_team_id, t.name, fst.franchise_key
         from public.teams t
         left join public.franchise_season_teams fst
           on fst.season = t.season and fst.espn_team_id = t.espn_team_id
        where t.season = $1`,
      [season]
    ),
  ]);

  const teamNames = Object.fromEntries(teams.map((t) => [t.espn_team_id, t.name]));
  const teamFranchises = Object.fromEntries(
    teams.filter((t) => t.franchise_key !== null).map((t) => [t.espn_team_id, t.franchise_key!])
  );
  return trades.map((trade) => {
    const mine = players.filter((p) => p.trade_id === trade.trade_id);
    return {
      trade,
      teamNames,
      teamFranchises,
      received: {
        [trade.team_a]: mine.filter((p) => p.to_team_id === trade.team_a),
        [trade.team_b]: mine.filter((p) => p.to_team_id === trade.team_b),
      },
      value: values.get(trade.trade_id)!,
    };
  });
}

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
  mine: number | null;
  tally: Record<number, number>;
}

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
