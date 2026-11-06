import { auth } from '@clerk/nextjs/server';
import { getComments } from '../../../lib/queries.ts';
import { getLockedWeekPicks } from '../../../lib/prediction-reveal.ts';

export const dynamic = 'force-dynamic';

/** On-demand, authenticated-only data; never cache member-specific responses. */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Sign in required' }, {
    status: 401,
    headers: { 'Cache-Control': 'private, no-store' },
  });

  const url = new URL(request.url);
  const season = Number(url.searchParams.get('season'));
  const week = Number(url.searchParams.get('week'));
  const kind = url.searchParams.get('kind');
  if (!Number.isInteger(season) || season < 2005 || season > 2100 ||
      !Number.isInteger(week) || week < 1 || week > 30 ||
      (kind !== 'picks' && kind !== 'comments')) {
    return Response.json({ error: 'Invalid league week' }, {
      status: 400,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const data = kind === 'picks'
    ? await getLockedWeekPicks(season, week)
    : await getComments(season, week);

  return Response.json({ data }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
