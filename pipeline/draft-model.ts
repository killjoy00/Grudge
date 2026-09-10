/** Retrospective draft value, expressed in season-normalized starter production. */
export const DRAFT_MODEL_VERSION = '2026.3';
export const DRAFT_VALUE_METHOD = 'production above replacement minus historical pick expectation';

export interface DraftPerformancePick {
  overall_pick: number;
  espn_team_id: number;
  espn_player_id: number;
  full_name: string;
  position: number;
  fantasy_points: number | null;
  active_weeks: number | null;
  performance_source: string;
}
export interface DraftPerformanceSeason {
  season: number;
  regular_weeks: number;
  team_count: number;
  total_picks: number;
  board?: [number, number, number][];
  excluded_board?: { overall_pick: number; espn_team_id: number; position: 'DST' | 'K'; evidence: string }[];
  slot_counts: Record<string, number>;
  /** All NFL offensive players, including undrafted/free-agent production. */
  pool: [string, number, number][];
  picks: DraftPerformancePick[];
}
export interface GradedPick extends DraftPerformancePick {
  season: number;
  total_picks: number;
  replacement_points: number;
  production_score: number;
  draft_capital_score: number;
  value_delta: number;
  benchmark_seasons: number;
  model_version: string;
}

const round = (n: number) => Math.round(n * 100) / 100;
const positions = [1, 2, 3, 4] as const;
const SLOT_POSITIONS: Record<string, number[]> = {
  0: [1], 2: [2], 3: [2, 3], 4: [3], 5: [3, 4], 6: [4],
  7: [1, 2, 3, 4], 23: [2, 3, 4],
};
const IGNORED_SLOTS = new Set(['16', '17', '20', '21']);

/**
 * Allocate the league's actual starting slots against the full NFL pool.
 * Enumerating position counts handles overlapping FLEX slots exactly without
 * assuming every position produces an equally useful distribution.
 */
export function draftReplacement(season: DraftPerformanceSeason) {
  const points = positions.map((pos) => season.pool.filter((p) => p[1] === pos)
    .map((p) => p[2]).sort((a, b) => b - a));
  const counts = [0, 0, 0, 0];
  const flex: number[][] = [];
  for (const [slot, n] of Object.entries(season.slot_counts)) {
    if (!n || IGNORED_SLOTS.has(slot)) continue;
    const eligible = SLOT_POSITIONS[slot];
    if (!eligible) throw new Error(`Unsupported offensive lineup slot ${slot}`);
    if (eligible.length === 1) counts[eligible[0]! - 1]! += n * season.team_count;
    else for (let i = 0; i < n * season.team_count; i++) flex.push(eligible);
  }
  for (let p = 0; p < 4; p++) {
    if (points[p]!.length <= counts[p]!) throw new Error(`${season.season}: incomplete position ${p + 1} pool`);
  }
  const value = (c: number[]) => c.reduce((total, n, p) =>
    total + points[p]!.slice(0, n).reduce((a, b) => a + b, 0), 0);
  let states = new Map([[counts.join(','), counts]]);
  for (const eligible of flex) {
    const next = new Map<string, number[]>();
    for (const state of states.values()) for (const pos of eligible) {
      const c = [...state]; c[pos - 1]!++;
      if (c[pos - 1]! >= points[pos - 1]!.length) continue;
      next.set(c.join(','), c);
    }
    states = next;
  }
  const chosen = [...states.values()].sort((a, b) => value(b) - value(a)
    || a.join(',').localeCompare(b.join(',')))[0];
  if (!chosen) throw new Error(`${season.season}: lineup cannot be filled`);
  const seats = chosen.reduce((a, b) => a + b, 0);
  const scale = value(chosen) / seats;
  if (!(scale > 0)) throw new Error(`${season.season}: no measured starter production`);
  return { levels: new Map<number, number>(positions.map((p) => [p, points[p - 1]![chosen[p - 1]!]!])), scale, counts: chosen };
}

interface ProductionPick extends DraftPerformancePick {
  season: number;
  total_picks: number;
  replacement_points: number;
  production_score: number;
}

export function draftProduction(seasons: DraftPerformanceSeason[]): ProductionPick[] {
  return seasons.flatMap((season) => {
    // Refuse a partial draft instead of allowing a missing pick to improve the
    // surviving class average or enter the benchmark as a zero-point bust.
    if (!season.picks.length || season.picks.some((p) => p.fantasy_points === null
      || !Number.isFinite(p.fantasy_points) || !positions.includes(p.position as 1 | 2 | 3 | 4))) return [];
    const { levels, scale } = draftReplacement(season);
    return season.picks.map((pick) => ({
      ...pick, season: season.season, total_picks: season.total_picks,
      replacement_points: round(levels.get(pick.position)!),
      production_score: 100 * Math.max(0, pick.fantasy_points! - levels.get(pick.position)!) / scale,
    }));
  });
}

/**
 * Smooth the expected return across the FULL draft board, including K/D slots.
 * Log distance gives early picks a narrow neighborhood and late picks a wider
 * one. Bandwidth is fixed, not selected for the most flattering backtest.
 * A held-out season never supplies observations to its own expectation.
 */
export function expectedDraftProduction(pick: ProductionPick, training: ProductionPick[], bandwidth = 0.35) {
  const coordinate = (p: ProductionPick) => Math.log((p.overall_pick - 0.5) / p.total_picks);
  let numerator = 0, denominator = 0;
  for (const other of training) {
    if (other.season === pick.season) continue;
    const distance = (coordinate(pick) - coordinate(other)) / bandwidth;
    const weight = Math.exp(-0.5 * distance * distance);
    numerator += weight * other.production_score;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

export function gradeDrafts(seasons: DraftPerformanceSeason[], chronological = false): GradedPick[] {
  const production = draftProduction(seasons);
  return production.flatMap((pick) => {
    const training = production.filter((p) => chronological ? p.season < pick.season : p.season !== pick.season);
    const benchmarkSeasons = new Set(training.map((p) => p.season)).size;
    if (benchmarkSeasons < 3) return [];
    const expected = expectedDraftProduction(pick, training);
    if (expected === null) return [];
    return [{
      ...pick, production_score: round(pick.production_score),
      draft_capital_score: round(expected),
      value_delta: round(pick.production_score - expected),
      benchmark_seasons: benchmarkSeasons, model_version: DRAFT_MODEL_VERSION,
    }];
  });
}
