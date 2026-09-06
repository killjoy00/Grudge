import { DraftRecordsSection } from '../../../components/DraftRecordsSection.tsx';
import { HistoryNav } from '../../../components/HistoryNav.tsx';
import { getDraftRecords } from '../../../lib/draft-records.ts';

export const dynamic = 'force-dynamic';

export default async function DraftHistoryPage() {
  const records = await getDraftRecords();

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">Draft archaeology</div>
        <h1>Draft history</h1>
        <p>
          One room for every recovered draft board, the best and worst draft classes,
          the biggest steals and busts, repeat-player habits, and each franchise&rsquo;s positional draft tendencies.
        </p>
      </div>

      <HistoryNav current="records" />
      <DraftRecordsSection records={records} full />
    </>
  );
}
