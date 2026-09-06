import 'server-only';

import { unstable_cache } from 'next/cache';

import { asPublic } from './db.ts';
import { seasonContext, type SeasonPlayerRow, type SeasonRosterRow } from '../pipeline/trade-value.ts';
import {
  franchiseProductionRecords,
  valueTradeProduction,
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

interface TradeMoveRow {
  trade_id: string;
  espn_player_id: number;
  from_team_id: number;
  to_team_id: number;
}

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
    asPublic<{ n: number }>('select count(*)::int as n from public.teams where season = $1', [season]),
  ]);

  const rows: SeasonRosterRow[] = rosterRows.map((r) => ({
    week: r.week,
    espn_team_id: r.espn_team_id,
    espn_player_id: r.espn_player_id,
    lineup_slot_id: r.lineup_slot_id,
    is_starter: r.is_starter,
    applied_points: Number(r.applied_points ?? 0),
  }));
  return seasonContext(rows, playerRows, teams[0]?.n || 10);
}

async function seasonProductionRaw(season: number) {
  const [trades, moves, context] = await Promise.all([
    asPublic<TradeLite>(
      `select season, trade_id, effective_week, team_a, team_b
         from public.trades where season = $1
        order by effective_week, trade_id`,
      [season]
    ),
    asPublic<TradeMoveRow>(
      `select trade_id, espn_player_id, from_team_id, to_team_id
         from public.trade_players where season = $1`,
      [season]
    ),
    contextFor(season),
  ]);

  const values: Record<string, TradeProductionValue> = {};
  for (const trade of trades) {
    values[trade.trade_id] = valueTradeProduction({
      effective_week: trade.effective_week,
      team_a: trade.team_a,
      team_b: trade.team_b,
      moves: moves.filter((move) => move.trade_id === trade.trade_id),
      ...context,
    });
  }
  return { trades, values };
}

export const getTradeProductionForSeason = unstable_cache(
  async (season: number) => (await seasonProductionRaw(season)).values,
  ['trade-production-season-v1'],
  { revalidate: 3600 }
);

export const getAllTimeTradeProductionRecords = unstable_cache(
  async (): Promise<FranchiseProductionRecord[]> => {
    const trades = await asPublic<TradeLite>(
      `select season, trade_id, effective_week, team_a, team_b
         from public.trades order by season, effective_week, trade_id`
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
  ['trade-production-all-time-v1'],
  { revalidate: 3600 }
);

export type { FranchiseProductionRecord, TradeProductionValue } from '../pipeline/trade-production.ts';
