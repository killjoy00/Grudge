import 'server-only';

import { unstable_cache } from 'next/cache';

import { asPublic } from './db.ts';
import { publishedTrades } from './published-trades.ts';
import {
  franchiseProductionRecords,
  type FranchiseProductionRecord,
  type TradeProductionValue,
} from '../pipeline/trade-production.ts';

interface TradeLite {
  season: number;
  trade_id: string;
  effective_week: number;
  team_a: number;
  team_b: number;
}

async function seasonProductionRaw(season: number) {
  const trades = await asPublic<TradeLite>(
    `select season, trade_id, effective_week, team_a, team_b from public.trades
     where season = $1 and evidence_status = 'active' order by effective_week, trade_id`, [season]);
  const values: Record<string, TradeProductionValue> = Object.fromEntries(
    (await publishedTrades(season)).map((r) => [r.trade_id, r.production]));
  for (const t of trades) values[t.trade_id] ??= {
    a: { espn_team_id: t.team_a, value: 0, playerWeeks: 0, received: [] },
    b: { espn_team_id: t.team_b, value: 0, playerWeeks: 0, received: [] },
    margin: 0, winner: null, graded: false, gradingReason: 'not_published',
  };
  return { trades, values };
}

export const getTradeProductionForSeason = unstable_cache(
  async (season: number) => (await seasonProductionRaw(season)).values,
  ['trade-production-season-v3'],
  { revalidate: 3600 }
);

export const getAllTimeTradeProductionRecords = unstable_cache(
  async (): Promise<FranchiseProductionRecord[]> => {
    const trades = await asPublic<TradeLite>(
      `select season, trade_id, effective_week, team_a, team_b
         from public.trades where evidence_status = 'active' order by season, effective_week, trade_id`
    );
    if (trades.length === 0) return [];

    const seasons = [...new Set(trades.map((trade) => trade.season))];
    const perSeason = await Promise.all(seasons.map((season) => seasonProductionRaw(season)));
    const franchises = await asPublic<{
      season: number; espn_team_id: number; franchise_key: string | null;
      current_name: string | null; team_name: string;
    }>(
      `select tf.season, tf.espn_team_id, tf.franchise_key, f.current_name, tf.team_name
         from public.team_franchise tf
         left join public.franchises f using (franchise_key)`
    );

    const byTeam = new Map(franchises.map((row) => [`${row.season}:${row.espn_team_id}`, row]));
    const seasonOf = new Map<string, number>();
    const valued: { trade_id: string; value: TradeProductionValue }[] = [];

    for (const result of perSeason) {
      for (const trade of result.trades) {
        const key = `${trade.season}:${trade.trade_id}`;
        seasonOf.set(key, trade.season);
        valued.push({ trade_id: key, value: result.values[trade.trade_id]! });
      }
    }

    return franchiseProductionRecords(
      valued,
      (season, teamId) => {
        const row = byTeam.get(`${season}:${teamId}`);
        if (!row?.franchise_key) return null;
        return { key: row.franchise_key, name: row.current_name ?? row.team_name };
      },
      (tradeId) => seasonOf.get(tradeId) ?? 0
    );
  },
  ['trade-production-all-time-v3'],
  { revalidate: 3600 }
);

export type { FranchiseProductionRecord, TradeProductionValue } from '../pipeline/trade-production.ts';
