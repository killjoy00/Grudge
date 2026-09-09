import { stmt, type Stmt } from '../pipeline/db.ts';

/**
 * Historical manager attribution is authoritative, but manager identities are
 * durable. Refreshing the commissioner-authored season assignments therefore
 * replaces manager_franchise_seasons without deleting rows from managers.
 *
 * This is especially important once provider crosswalks such as
 * manager_espn_members reference those durable manager keys.
 */
export function historyImportPruneStatements(
  hasManagers: boolean,
  hasManagerSeasons: boolean
): Stmt[] {
  if (!hasManagers || !hasManagerSeasons) return [];
  return [stmt('delete from public.manager_franchise_seasons')];
}
