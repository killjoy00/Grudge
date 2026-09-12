import { stmt, upsertChunked, type Stmt } from './db.ts';
import type { DraftPickRow, MatchupProjectionRow } from './normalize.ts';

/**
 * Writes for the week-ahead capture.
 *
 * Projection evidence is immutable by default. The weekly workflow is also used
 * as a verification/recovery path, so a routine rerun must not silently change
 * the line that Grudge later scores as ESPN's prediction. An operator may make
 * an explicit recapture, in which case both the values and captured_at move
 * together so the UI never combines a new line with an old timestamp.
 *
 * Draft picks remain ordinary idempotent reference data. The final statement
 * also heals the legacy `players` cache from the canonical season-aware player
 * identity table. That cache is still read by a few week-one surfaces, and new
 * rookies can otherwise appear as "ESPN player #..." even after identity
 * resolution has already succeeded elsewhere.
 */
export function previewStatements(
  projections: MatchupProjectionRow[],
  picks: DraftPickRow[],
  season: number,
  capturedAt: string,
  recapture = false,
): Stmt[] {
  const projectionRows = projections.map((row) => ({ ...row, captured_at: capturedAt }));

  return [
    ...upsertChunked(
      'public.matchup_projections',
      ['season', 'week', 'espn_matchup_id', 'espn_team_id', 'projected_points', 'starters', 'captured_at'],
      projectionRows as unknown as Record<string, unknown>[],
      ['season', 'week', 'espn_team_id'],
      recapture ? ['espn_matchup_id', 'projected_points', 'starters', 'captured_at'] : [],
    ),
    ...upsertChunked(
      'public.draft_picks',
      ['season', 'overall_pick', 'round', 'round_pick', 'espn_team_id', 'espn_player_id',
       'is_keeper'],
      picks as unknown as Record<string, unknown>[],
      ['season', 'overall_pick'],
    ),
    stmt(
      `insert into public.players as p
         (espn_player_id, full_name, default_position_id, pro_team_id, eligible_slots)
       select pi.espn_player_id, pi.full_name, pi.position_id, null, pi.eligible_slots
         from public.player_identity pi
        where pi.season = $1
          and pi.full_name is not null
          and btrim(pi.full_name) <> ''
          and pi.full_name not like 'ESPN player #%'
       on conflict (espn_player_id) do update set
         full_name = case
           when p.full_name is null
             or btrim(p.full_name) = ''
             or p.full_name = 'ESPN player #' || p.espn_player_id::text
           then excluded.full_name else p.full_name end,
         default_position_id = coalesce(p.default_position_id, excluded.default_position_id),
         eligible_slots = case
           when coalesce(cardinality(p.eligible_slots), 0) = 0 then excluded.eligible_slots
           else p.eligible_slots end`,
      [season],
    ),
  ];
}
