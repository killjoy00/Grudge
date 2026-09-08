import 'server-only';
import { asPublic } from './db.ts';
import { PUBLISHED_TRADE_SQL } from './model-queries.ts';
import { TRADE_MODEL_VERSION } from '../pipeline/model-publish.ts';
import type { TradeValue } from '../pipeline/trade-value.ts';
import type { TradeProductionValue } from '../pipeline/trade-production.ts';

export function publishedTrades(season?: number) {
  return asPublic<{ season: number; trade_id: string; fit: TradeValue; production: TradeProductionValue }>(
    `${PUBLISHED_TRADE_SQL} and m.model_version = $1 ${season === undefined ? '' : 'and t.season = $2'}`,
    season === undefined ? [TRADE_MODEL_VERSION] : [TRADE_MODEL_VERSION, season]);
}

/** Explicit absence of a published model is never an even trade. */
export function unpublishedTrade(teamA: number, teamB: number): TradeValue {
  const side = (id: number) => ({ espn_team_id: id, lineupImpact: 0, playerValue: 0,
    valuedWeeks: 0, rosteredPoints: 0, startedPoints: 0, received: [], gaveUp: [] });
  return { a: side(teamA), b: side(teamB), margin: 0, winner: null, weeksScored: 0,
    mutual: false, graded: false, gradingReason: 'not_published' };
}
