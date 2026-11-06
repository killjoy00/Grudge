import { redirect } from 'next/navigation';

// Preserve existing /rankings?season= links without running league queries on
// the compatibility route. The season-specific page is cached by Vercel.
export default async function RankingsIndex({
  searchParams,
}: { searchParams: Promise<{ season?: string | string[] }> }) {
  const { season } = await searchParams;
  const year = typeof season === 'string' && /^(19|20)\d{2}$/.test(season)
    ? season : 'current';
  redirect(`/rankings/season/${year}`);
}
