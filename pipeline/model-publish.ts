import { gradeDrafts, DRAFT_MODEL_VERSION, type DraftPerformanceSeason } from './draft-model.ts';
import { valueTrade } from './trade-value.ts';
import { valueTradeProduction } from './trade-production.ts';
import { digest, type PlayerWeekScore } from './player-week.ts';
import { stmt, type Stmt } from './db.ts';
import type { SeasonContext } from './trade-value.ts';
import type { DetectedTrade } from './trade-history.ts';

export const TRADE_MODEL_VERSION = '2026.3';

/** Re-read canonical scores: metadata snapshots never override a score correction. */
export function draftInputsFromScores(bases: DraftPerformanceSeason[], scores: PlayerWeekScore[],
  boards: { season: number; overall_pick: number; espn_team_id: number; espn_player_id: number }[]) {
  const indexed = new Map(scores.map((s) => [`${s.season}:${s.week}:${s.player_key}`, s]));
  const coverage: Record<string, { ready: boolean; reasons: string[]; source_hash: string }> = {};
  const seasons = bases.map((base) => {
    const reasons = new Set<string>();
    const board = boards.filter((b) => b.season === base.season);
    const expectedBoard = base.board ?? [];
    const excludedBoard = base.excluded_board ?? [];
    const actualBoard = new Set(board.map((b) => `${b.overall_pick}:${b.espn_team_id}:${b.espn_player_id}`));
    const coveredCoordinates = new Set([
      ...expectedBoard.map((p) => p[0]),
      ...excludedBoard.map((p) => p.overall_pick),
    ]);
    const coordinatesComplete = coveredCoordinates.size === base.total_picks
      && Array.from({ length: base.total_picks }, (_, i) => i + 1).every((pick) => coveredCoordinates.has(pick));
    if (!coordinatesComplete || expectedBoard.length + excludedBoard.length !== base.total_picks
      || board.length !== expectedBoard.length || expectedBoard.some((p) => !actualBoard.has(p.join(':')))
      || base.picks.some((p) => !actualBoard.has(`${p.overall_pick}:${p.espn_team_id}:${p.espn_player_id}`))) reasons.add('draft_board_mismatch');
    function production(key: string) {
      const rows: PlayerWeekScore[] = [];
      for (let week = 1; week <= base.regular_weeks; week++) {
        const row = indexed.get(`${base.season}:${week}:${key}`);
        if (!row || row.points === null || !Number.isFinite(Number(row.points))
          || row.evidence === 'missing' || row.evidence === 'conflict') reasons.add('incomplete_player_week_coverage');
        else rows.push(row);
      }
      return rows;
    }
    const pool = base.pool.map(([id, pos]) => {
      const rows = production(`gsis:${id}`);
      return [id, pos, rows.reduce((sum, r) => sum + Number(r.points), 0)] as [string, number, number];
    });
    const picks = base.picks.map((pick) => {
      const rows = production(pick.player_key);
      const reconstructed = rows.some((r) => r.evidence === 'reconstructed');
      const observed = rows.some((r) => r.evidence === 'observed');
      return { ...pick,
        fantasy_points: rows.reduce((sum, r) => sum + Number(r.points), 0),
        active_weeks: rows.filter((r) => Number(r.points) !== 0).length,
        performance_source: reconstructed ? observed ? 'espn_nflverse' : 'nflverse'
          : observed ? 'espn_weekly' : 'no_regular_season_stats',
      };
    });
    const evidenceRows = scores.filter((s) => s.season === base.season && s.week <= base.regular_weeks)
      .sort((a, b) => a.week - b.week || a.player_key.localeCompare(b.player_key))
      .map((s) => [s.week, s.player_key, s.points === null ? null : Number(s.points), s.evidence,
        s.source, s.scoring_version, s.input_hash]);
    coverage[base.season] = { ready: reasons.size === 0, reasons: [...reasons], source_hash: digest(evidenceRows) };
    return { ...base, pool, picks: picks.map((p) => ({ ...p, fantasy_points: reasons.size ? null : p.fantasy_points })) };
  });
  return { seasons, coverage };
}

export function draftPublicationStatements(seasons: DraftPerformanceSeason[], coverage: Record<string, unknown>): Stmt[] {
  const inputHash = digest([seasons, coverage]);
  const runId = digest(['draft', DRAFT_MODEL_VERSION, inputHash]);
  // The committed identity artifact is already the authority used to find each
  // pick's canonical scoring rows. Carry that same identity into publication.
  // Do not depend on nfl_player_aliases already having been backfilled for a
  // newly recovered season: publication may be the first writer to use it.
  const grades = gradeDrafts(seasons);
  const out = [stmt(`insert into public.model_runs (run_id, model_kind, model_version, input_hash, coverage)
    values ($1, 'draft', $2, $3, $4::jsonb) on conflict do nothing`,
  [runId, DRAFT_MODEL_VERSION, inputHash, JSON.stringify(coverage)])];
  for (let i = 0; i < grades.length; i += 500) out.push(stmt(`
    insert into public.draft_grade_results
      (run_id, season, overall_pick, espn_team_id, espn_player_id, player_key, result)
    select $1, (x->>'season')::int, (x->>'overall_pick')::int, (x->>'espn_team_id')::int,
      (x->>'espn_player_id')::bigint, x->>'player_key', x
      from jsonb_array_elements($2::jsonb) x
    on conflict do nothing`, [runId, JSON.stringify(grades.slice(i, i + 500))]));
  for (const season of seasons) {
    const ready = grades.filter((g) => g.season === season.season).length === season.picks.length && season.picks.length > 0;
    out.push(stmt(`insert into public.model_publications (model_kind, season, run_id, coverage_status, coverage_detail)
      values ('draft', $1, $2, $3, $4::jsonb) on conflict (model_kind, season) do update set
      run_id = excluded.run_id, coverage_status = excluded.coverage_status, coverage_detail = excluded.coverage_detail`,
    [season.season, ready ? runId : null, ready ? 'ready' : 'blocked', JSON.stringify(coverage[season.season] ?? {})]));
  }
  return out;
}

export function tradePublicationStatements(season: number,
  trades: (DetectedTrade & { revision_hash: string })[], context: SeasonContext,
  fingerprintInput: unknown, evidence: Record<string, number>): Stmt[] {
  const inputHash = digest([trades, fingerprintInput]);
  const runId = digest(['trade', TRADE_MODEL_VERSION, season, inputHash]);
  const values = trades.map((t) => ({ trade: t,
    fit: valueTrade({ ...t, moves: t.players, ...context }),
    production: valueTradeProduction({ ...t, moves: t.players, ...context }),
  }));
  const coverage = { evidence, trades: values.length,
    fit_graded: values.filter((v) => v.fit.graded).length,
    production_graded: values.filter((v) => v.production.graded).length };
  const out = [stmt(`insert into public.model_runs (run_id, model_kind, model_version, input_hash, as_of_week, coverage)
    values ($1, 'trade', $2, $3, $4, $5::jsonb) on conflict do nothing`,
  [runId, TRADE_MODEL_VERSION, inputHash, context.weeks.at(-1) ?? null, JSON.stringify(coverage)])];
  for (const v of values) out.push(stmt(`insert into public.trade_grade_results
    (run_id, season, trade_id, trade_revision, fit, production) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
    on conflict do nothing`, [runId, season, v.trade.trade_id, v.trade.revision_hash, JSON.stringify(v.fit), JSON.stringify(v.production)]));
  out.push(stmt(`insert into public.model_publications (model_kind, season, run_id)
    values ('trade', $1, $2) on conflict (model_kind, season) do update set
    run_id = excluded.run_id, coverage_status = 'ready', coverage_detail = '{}'::jsonb`, [season, runId]));
  return out;
}
