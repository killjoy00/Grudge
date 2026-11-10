import { createHash } from 'node:crypto';
import identities from '../data/derived/player-identities.json' with { type: 'json' };
import seasonIdentities from '../data/draft-player-season-identities.json' with { type: 'json' };
import { stmt, type Stmt } from './db.ts';
import { classifyScoreCopies } from './scoring-evidence.ts';

export type ScoringEvidence = 'observed' | 'reconstructed' | 'verified_zero' | 'missing' | 'conflict';
export interface PlayerWeekScore {
  season: number; week: number; player_key: string; espn_player_id: number | null;
  position_id: number | null; points: number | null; evidence: ScoringEvidence;
  source: string; scoring_version: string; input_hash: string;
}
export const SUPERSEDED_HISTORICAL_SOURCE = 'superseded_historical';

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
const seasonIdentityMap = new Map(
  (seasonIdentities.players as { season: number; espn_id: number; gsis_id: string }[])
    .map((row) => [`${row.season}:${row.espn_id}`, row.gsis_id]),
);

export function canonicalPlayerKey(id: number, season?: number): string {
  // ESPN encodes NFL defensive units as -16000 minus its pro-team id. The NFL
  // player directory intentionally gives those durable franchise identities
  // (`dst:1`, `dst:2`, ...), so never emit a parallel `espn:-16002` identity.
  if (id <= -16001 && id >= -16099) return `dst:${-id - 16000}`;
  const gsis = (season === undefined ? undefined : seasonIdentityMap.get(`${season}:${id}`))
    ?? (identities as Record<string, string>)[String(id)];
  return gsis ? `gsis:${gsis}` : `espn:${id}`;
}

/** Conflicting ownership copies are missing evidence, never max(points). */
export function observedPlayerWeeks(
  rows: { season: number; week: number; espn_player_id: number; applied_points: number | null }[],
  positions: Map<number, number>, scoringVersion: string,
): PlayerWeekScore[] {
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.season}:${row.week}:${row.espn_player_id}`;
    const group = grouped.get(key) ?? []; group.push(row); grouped.set(key, group);
  }
  return [...grouped.values()].map((copies): PlayerWeekScore => {
    const row = copies[0]!;
    const { values, points, evidence } = classifyScoreCopies(copies.map((r) => r.applied_points));
    return {
      season: row.season, week: row.week, player_key: canonicalPlayerKey(row.espn_player_id, row.season),
      espn_player_id: row.espn_player_id, position_id: positions.get(row.espn_player_id) ?? null,
      points, evidence,
      source: 'espn_weekly', scoring_version: scoringVersion,
      input_hash: digest({ values, scoringVersion }),
    };
  }).sort((a, b) => a.season - b.season || a.week - b.week || a.player_key.localeCompare(b.player_key));
}

/**
 * A fresh exact score can correct an old exact score. Estimates cannot replace it.
 *
 * The week also has a second unique key, (season, week, espn_player_id).
 * Live ESPN evidence may use a provisional espn:* key while the player
 * directory has already resolved the same provider id to a GSIS identity.
 * Resolving ONLY the player-key conflict left that second constraint exposed
 * on reruns. Resolve the identity from the season-scoped alias first, then
 * from the already-published provider row, before attempting the upsert.
 */
export function scoreStatements(rows: PlayerWeekScore[]): Stmt[] {
  const out: Stmt[] = [];
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const payload = JSON.stringify(chunk);
    const observed = chunk.some((row) => row.source === 'espn_weekly' && row.espn_player_id !== null);

    if (observed) {
      // The season-scoped alias is authoritative even when an earlier weekly
      // import used a synthetic GSIS key (e.g. WAS569019). Rekey only when the
      // destination is vacant and no other ESPN player owns the old identity.
      // Genuine dual-ownership conflicts must still fail and roll back.
      out.push(stmt(`
        with incoming as (
          select x.season, x.week, x.espn_player_id, a.player_key
            from jsonb_to_recordset($1::jsonb)
              as x(season int, week int, espn_player_id bigint, source text)
            join public.nfl_player_aliases a
              on a.season = x.season and a.espn_player_id = x.espn_player_id
           where x.source = 'espn_weekly'
        )
        update public.player_week_scores as saved
           set player_key = incoming.player_key, updated_at = now()
          from incoming
         where saved.season = incoming.season
           and saved.week = incoming.week
           and saved.espn_player_id = incoming.espn_player_id
           and saved.source = 'espn_weekly'
           and saved.player_key <> incoming.player_key
           and not exists (
             select 1 from public.nfl_player_aliases as other_alias
              where other_alias.season = saved.season
                and other_alias.player_key = saved.player_key
                and other_alias.espn_player_id <> saved.espn_player_id
           )
           and not exists (
             select 1 from public.player_week_scores as occupied
              where occupied.season = incoming.season
                and occupied.week = incoming.week
                and occupied.player_key = incoming.player_key
           )
      `, [payload]));
    }

    out.push(stmt(`
      insert into public.player_week_scores
        (season, week, player_key, espn_player_id, position_id, points, evidence, source, scoring_version, input_hash)
      select x.season, x.week,
        ${observed ? `case when x.source = 'espn_weekly' and x.espn_player_id is not null
          then coalesce(alias.player_key, prior.player_key, x.player_key)
          else x.player_key end` : 'x.player_key'},
        x.espn_player_id, x.position_id, x.points, x.evidence, x.source, x.scoring_version, x.input_hash
        from jsonb_to_recordset($1::jsonb) as x(season int, week int, player_key text,
          espn_player_id bigint, position_id int, points numeric, evidence text, source text,
          scoring_version text, input_hash text)
        ${observed ? `left join public.nfl_player_aliases alias
          on alias.season = x.season and alias.espn_player_id = x.espn_player_id
         left join public.player_week_scores prior
          on prior.season = x.season and prior.week = x.week and prior.espn_player_id = x.espn_player_id` : ''}
       where true
      on conflict (season, week, player_key) do update set
        espn_player_id = coalesce(excluded.espn_player_id, player_week_scores.espn_player_id),
        position_id = coalesce(excluded.position_id, player_week_scores.position_id),
        points = excluded.points, evidence = excluded.evidence, source = excluded.source,
        scoring_version = excluded.scoring_version, input_hash = excluded.input_hash, updated_at = now()
      where (excluded.source = 'espn_weekly' or player_week_scores.source <> 'espn_weekly')
        and (excluded.evidence <> 'missing' or player_week_scores.evidence = 'missing')
        and (excluded.evidence in ('observed', 'conflict') or player_week_scores.evidence <> 'observed')
        and (player_week_scores.input_hash, player_week_scores.evidence, player_week_scores.points)
          is distinct from (excluded.input_hash, excluded.evidence, excluded.points)
    `, [payload]));
  }
  return out;
}

/**
 * Reconcile the reproducible historical regular-season layer without granting
 * the pipeline DELETE. Existing derived rows are first retired in place: this
 * frees provider IDs that were historically reused while preserving an audit
 * tombstone. Canonical rows in the new artifact are then reactivated by the
 * normal score upsert; stale identities remain inert and are excluded from
 * model publication reads.
 */
export function replaceHistoricalScoreStatements(season: number, rows: PlayerWeekScore[]): Stmt[] {
  if (rows.some((row) => row.season !== season || !['historical_espn', 'nflverse'].includes(row.source))) {
    throw new Error(`Invalid historical score replacement for ${season}`);
  }
  return [
    stmt(`update public.player_week_scores
      set espn_player_id = null,
          position_id = null,
          points = null,
          evidence = 'missing',
          source = $2,
          scoring_version = 'superseded',
          input_hash = 'superseded',
          updated_at = now()
      where season = $1 and source in ('historical_espn', 'nflverse')`, [season, SUPERSEDED_HISTORICAL_SOURCE]),
    ...scoreStatements(rows),
  ];
}
