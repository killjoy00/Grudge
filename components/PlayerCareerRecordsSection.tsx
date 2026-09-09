import { MetricBars } from './MetricBars.tsx';
import { playerHref } from '../lib/player-data.ts';
import { getPlayerRecordLeaders } from '../lib/player-intelligence.ts';

export async function PlayerCareerRecordsSection({ compact = false }: { compact?: boolean }) {
  const records = await getPlayerRecordLeaders(compact ? 8 : 10);
  return <>
    <h2>Player career records</h2>
    <p className="sub">Canonical player identities connect the draft archive back to 2005 with the recoverable weekly lineup and trade era from 2018 onward.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
      <div className="card">
        <strong>Career starter points · 2018+</strong>
        <div style={{ marginTop: 14 }}><MetricBars rows={records.starterPoints.map((row) => ({
          key: row.player_key,
          label: `${row.full_name} · ${row.position}`,
          value: Number(row.points),
          display: `${Number(row.points).toFixed(1)} pts`,
          href: playerHref(row.player_key, row.latest_season),
          detail: `${row.starts} starts · ${row.seasons} season${row.seasons === 1 ? '' : 's'}`,
        }))} /></div>
      </div>
      <div className="card">
        <strong>Most drafted · 2005+</strong>
        <div style={{ marginTop: 14 }}><MetricBars rows={records.drafted.map((row) => ({
          key: row.player_key,
          label: `${row.full_name} · ${row.position}`,
          value: row.events,
          display: `${row.events} draft${row.events === 1 ? '' : 's'}`,
          href: playerHref(row.player_key, row.last_season),
          detail: `${row.first_season}–${row.last_season}`,
        }))} /></div>
      </div>
    </div>
    {!compact && <p className="note"><a href="/players/records">Open the full player record book, including most-traded players →</a></p>}
  </>;
}
