/**
 * Free-agent pool as JSON, for the admin table's client-side sort and filter.
 *
 * Gated by requireAdminApi(), and gated AGAIN by the RLS policy on
 * player_ownership_snapshots. Deleting the guard below would turn this route
 * into one that returns `[]` to a non-admin -- not one that leaks the pool.
 * tests/admin/verify-gating.mjs asserts exactly that, against a real
 * non-admin Clerk session rather than against the UI.
 */
import { requireAdminApi } from '../../../../lib/admin.ts';
import { getPool, getPoolOpportunities, getSnapshotCoverage } from '../../../../lib/admin-queries.ts';

// Reads the session, so it can never be cached or statically rendered.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const season = Number(url.searchParams.get('season'));
  const week = Number(url.searchParams.get('week'));

  if (!Number.isInteger(season) || season < 2018 || season > 2100) {
    return Response.json({ error: 'season must be a year' }, { status: 400 });
  }
  if (!Number.isInteger(week) || week < 1 || week > 17) {
    return Response.json({ error: 'week must be 1..17' }, { status: 400 });
  }

  const [pool, opportunities, coverage] = await Promise.all([
    getPool(season, week),
    getPoolOpportunities(season, week),
    getSnapshotCoverage(season),
  ]);

  return Response.json({ season, week, pool, opportunities, coverage });
}
