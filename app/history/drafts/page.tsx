import { DraftRecordsSection } from '../../../components/DraftRecordsSection.tsx';
import { DraftSlotSection } from '../../../components/DraftSlotSection.tsx';
import { HistoryNav } from '../../../components/HistoryNav.tsx';
import { getDraftRecords } from '../../../lib/draft-records.ts';
import { getDraftSlotRecords } from '../../../lib/draft-slot-records.ts';

export const dynamic = 'force-dynamic';

export default async function DraftHistoryPage() {
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
