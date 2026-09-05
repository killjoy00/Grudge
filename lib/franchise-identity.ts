/**
 * ESPN mostly kept the same numeric team id for each durable franchise across
 * the league's history. The one verified exception is the franchise that is
 * now CTE Deniers: it was team 7 in 2005, then team 10 from 2006 onward.
 *
 * Keep that fact in one place so all-time rivalry queries can use durable
 * franchise identity without rewriting the raw ESPN archive.
 */
export function canonicalEspnTeamId(season: number, espnTeamId: number): number {
  return season === 2005 && espnTeamId === 7 ? 10 : espnTeamId;
}

/** SQL equivalent of canonicalEspnTeamId for trusted internal column expressions. */
export function canonicalEspnTeamIdSql(seasonExpr: string, teamExpr: string): string {
  return `(case when ${seasonExpr} = 2005 and ${teamExpr} = 7 then 10 else ${teamExpr} end)`;
}
