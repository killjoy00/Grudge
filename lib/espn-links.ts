/**
 * Links back to ESPN.
 *
 * This site is the league's memory: records, rivalries, the argument. ESPN is
 * where the live roster and the live scoreboard are. Rather than mirror either,
 * every team and every matchup links straight across.
 *
 * Deliberately NOT in lib/queries.ts, which is `server-only` -- the pick form
 * is a client component and needs these too, and a server-only import there
 * would fail the build. Nothing here touches the database, so it is safe on
 * both sides.
 *
 * The league id is public: it is in every ESPN URL anyone in the league already
 * has bookmarked. Duplicated from pipeline/espn.ts on purpose, because that
 * module drags the whole fetch layer with it.
 */
export const ESPN_LEAGUE_ID = 114052;

/** A team's live roster and lineup. */
export function espnTeamUrl(espnTeamId: number, season: number): string {
  return `https://fantasy.espn.com/football/team?leagueId=${ESPN_LEAGUE_ID}` +
    `&seasonId=${season}&teamId=${espnTeamId}`;
}

/**
 * A week's live scoreboard, opened on one team's game.
 *
 * ESPN calls the week `matchupPeriodId`, which is the same number this site
 * calls `week` -- both count matchup periods, not NFL scoring periods, so they
 * agree through the regular season.
 */
export function espnMatchupUrl(
  season: number, week: number, espnTeamId: number
): string {
  return `https://fantasy.espn.com/football/fantasycast?leagueId=${ESPN_LEAGUE_ID}` +
    `&matchupPeriodId=${week}&seasonId=${season}&teamId=${espnTeamId}`;
}
