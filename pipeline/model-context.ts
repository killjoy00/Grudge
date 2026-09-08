import { TRADE_GAMES_SQL, TRADE_PLAYERS_SQL, TRADE_POINTS_SQL, TRADE_ROSTER_SQL } from '../lib/model-queries.ts';
import { seasonContext, type SeasonPlayerRow, type SeasonRosterRow } from './trade-value.ts';
import type { ScoringEvidence } from './player-week.ts';

export type ModelQuery = <T>(text: string, params?: unknown[]) => Promise<T[]>;
export async function loadTradeContext(query: ModelQuery, season: number) {
  const [rows, players, scores, games, settings, weeks] = await Promise.all([
    query<Omit<SeasonRosterRow, 'applied_points'> & { applied_points: string | null }>(TRADE_ROSTER_SQL, [season]),
    query<SeasonPlayerRow>(TRADE_PLAYERS_SQL, [season]),
    query<{ week: number; espn_player_id: number; points: string | null; started: boolean; evidence: ScoringEvidence }>(TRADE_POINTS_SQL, [season]),
    query<{ week: number; team_id: number }>(TRADE_GAMES_SQL, [season]),
    query<{ team_count: number; regular_season_weeks: number }>('select team_count, regular_season_weeks from public.seasons where season = $1', [season]),
    query<{ week: number }>('select week from public.weeks where season = $1 and results_complete order by week', [season]),
  ]);
  const evidence = scores.reduce((a, r) => { a[r.evidence] = (a[r.evidence] ?? 0) + 1; return a; }, {} as Record<string, number>);
  const context = seasonContext(rows.map((r) => ({ ...r, applied_points: r.applied_points === null ? null : Number(r.applied_points) })),
    players, settings[0]?.team_count ?? 10, {
      points: scores.map((r) => ({ ...r, points: r.points === null ? null : Number(r.points) })),
      weeks: weeks.map((r) => r.week), regularWeeks: settings[0]?.regular_season_weeks ?? 0, trackedGames: games,
    });
  return { context, evidence, fingerprintInput: { rows, players, scores, games, settings, weeks } };
}
