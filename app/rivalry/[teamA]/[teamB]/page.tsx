import { redirect } from 'next/navigation';

/**
 * Legacy compatibility route. Grudges now belong to managers, not permanent
 * franchise slots, and this old URL does not contain enough information to
 * infer which historical managers the visitor meant. Send old links to the
 * manager-grudge directory instead of showing a competing franchise series.
 */
export default function LegacyRivalryPage() {
  redirect('/history/rivalries');
}
