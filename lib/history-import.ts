import { stmt, type Stmt } from '../pipeline/db.ts';

/**
 * Historical manager attribution is authoritative only for the seasons being
 * imported. Manager identities are durable, and live/current-season manager
 * assignments can exist before a season has settled.
 *
 * Refreshing commissioner-authored history therefore replaces attribution only
 * inside the imported season set. It never deletes rows from managers and never
 * wipes a newer identity-only season such as 2026.
 */
export function historyImportPruneStatements(
  managerSeasons: Array<{ season: number }>
): Stmt[] {
  const seasons = [...new Set(managerSeasons.map((row) => row.season))].sort((a, b) => a - b);
  if (seasons.length === 0) return [];
  const placeholders = seasons.map((_, index) => `$${index + 1}`).join(', ');
  return [stmt(
    `delete from public.manager_franchise_seasons where season in (${placeholders})`,
    seasons
  )];
}
