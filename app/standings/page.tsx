import { redirect } from 'next/navigation';

// Backward-compatible entry point. The expensive report is an ISR path.
export default async function StandingsIndex({
  searchParams,
}: { searchParams: Promise<{ season?: string | string[] }> }) {
  const { season } = await searchParams;
  const year = typeof season === 'string' && /^(19|20)\d{2}$/.test(season)
    ? season : 'current';
  redirect(`/standings/season/${year}`);
}
