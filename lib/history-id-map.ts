import type { FranchiseIdMapping } from './espn-archive.ts';

/**
 * Resolve a durable franchise to the ESPN team id it used in one season.
 *
 * Most franchises kept one ESPN id for the life of the league. The mapping is
 * still season-bounded because one verified exception exists: the franchise
 * now known as CTE Deniers was team 7 in 2005 and team 10 from 2006 onward.
 * Keeping this in the checked-in identity ledger prevents page/query-specific
 * aliases from drifting apart.
 */
export function espnTeamIdForFranchise(
  mappings: FranchiseIdMapping[],
  franchiseKey: string,
  season: number
): number | null {
  const matches = mappings.filter(
    (mapping) =>
      mapping.franchise_key === franchiseKey &&
      season >= mapping.start_season &&
      (mapping.end_season === null || season <= mapping.end_season)
  );

  if (matches.length > 1) {
    throw new Error(
      `${season} ${franchiseKey}: multiple ESPN team-id mappings apply (${matches
        .map((mapping) => mapping.espn_team_id)
        .join(', ')}).`
    );
  }
  return matches[0]?.espn_team_id ?? null;
}

/**
 * Attach ESPN ids to season rows without changing their commissioner-authored
 * standings, playoff finish, points or championship fields.
 */
export function attachEspnTeamIds<T extends { season: number; franchise_key: string; espn_team_id: number | null }>(
  rows: T[],
  mappings: FranchiseIdMapping[],
  { requireMapping = true }: { requireMapping?: boolean } = {}
): T[] {
  return rows.map((row) => {
    const mapped = espnTeamIdForFranchise(mappings, row.franchise_key, row.season);
    if (mapped === null) {
      if (requireMapping) {
        throw new Error(`${row.season} ${row.franchise_key}: no ESPN team-id mapping applies.`);
      }
      return row;
    }
    if (row.espn_team_id !== null && row.espn_team_id !== mapped) {
      throw new Error(
        `${row.season} ${row.franchise_key}: season file says ESPN team ${row.espn_team_id}, ` +
          `identity ledger says ${mapped}.`
      );
    }
    return { ...row, espn_team_id: mapped };
  });
}
