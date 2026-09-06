export const TITLE_PLAYOFF_TIER = 'WINNERS_BRACKET';

/**
 * The Grudge ledger counts every regular-season game, then only the five games
 * in ESPN's championship bracket. A blank/malformed playoff tier after the
 * regular-season boundary must never make a placement game count by accident.
 */
export function isTrackedGame(
  week: number,
  regularSeasonWeeks: number,
  tier: string | null | undefined
): boolean {
  return week <= regularSeasonWeeks || tier === TITLE_PLAYOFF_TIER;
}

/**
 * SQL form of the same rule for raw matchup reads.
 *
 * The season table is authoritative for the regular-season boundary. This is
 * intentionally stricter than checking playoff_tier alone: once that boundary
 * is crossed, only an explicit WINNERS_BRACKET row is a Grudge game.
 */
export function trackedMatchupSql(alias = 'm'): string {
  return `exists (
    select 1
      from public.seasons tracked_season
     where tracked_season.season = ${alias}.season
       and (
         ${alias}.week <= tracked_season.regular_season_weeks
         or ${alias}.playoff_tier = '${TITLE_PLAYOFF_TIER}'
       )
  )`;
}
