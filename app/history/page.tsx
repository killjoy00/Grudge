import { redirect } from 'next/navigation';

// Preserve existing ?from= / ?to= links while serving cached route snapshots.
export default async function HistoryIndex({
  searchParams,
}: { searchParams: Promise<{ from?: string | string[]; to?: string | string[] }> }) {
  const { from, to } = await searchParams;
  const fromYear = typeof from === 'string' && /^(19|20)\d{2}$/.test(from) ? from : null;
  const toYear = typeof to === 'string' && /^(19|20)\d{2}$/.test(to) ? to : null;
  redirect(fromYear || toYear
    ? `/history/range/${fromYear ?? 'start'}-${toYear ?? 'end'}`
    : '/history/range/all');
}
