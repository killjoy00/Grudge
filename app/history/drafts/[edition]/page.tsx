import { notFound } from 'next/navigation';
import { DraftRecordsSection } from '../../../../components/DraftRecordsSection.tsx';
import { DraftSlotSection } from '../../../../components/DraftSlotSection.tsx';
import { HistoryNav } from '../../../../components/HistoryNav.tsx';
import { getDraftRecords } from '../../../../lib/draft-records.ts';
import { getDraftSlotRecords } from '../../../../lib/draft-slot-records.ts';

// Database access is deferred until the first hit; public report HTML
// is then served from Vercel's CDN for a full weekly cycle.
export const revalidate = 604800;
export function generateStaticParams(): Array<{ edition: string }> { return []; }

export default async function DraftHistoryPage({ params }: { params: Promise<{ edition: string }> }) {
  const { edition } = await params;
  if (edition !== 'weekly') notFound();
  const [records, slotRecords] = await Promise.all([
    getDraftRecords(),
    getDraftSlotRecords(),
  ]);

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">Draft archaeology</div>
        <h1>Draft history</h1>
        <p>
          One room for every recovered draft board, the best and worst draft classes,
          the biggest steals and busts, positional tendencies, and how each draft slot has performed over time.
        </p>
      </div>

      <HistoryNav current="records" />
      <DraftRecordsSection records={records} full />
      <DraftSlotSection records={slotRecords} />
    </>
  );
}
