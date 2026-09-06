export const TITLE_PLAYOFF_TIER = 'WINNERS_BRACKET';

/**
 * The league's historical record counts every regular-season game and only the
 * five games in the championship bracket after the regular season. ESPN's
 * consolation ladder decides placement, but it is not part of Grudge W-L,
 * rivalry, record-book, or single-game history.
 */
export function isTrackedPlayoffTier(tier: string | null | undefined): boolean {
  return tier === null || tier === undefined || tier === 'NONE' || tier === TITLE_PLAYOFF_TIER;
}

/** SQL form of the same policy for queries that read the raw matchup ledger. */
export function trackedMatchupSql(alias = 'm'): string {
  return `(${alias}.playoff_tier is null or ${alias}.playoff_tier in ('NONE', '${TITLE_PLAYOFF_TIER}'))`;
}
