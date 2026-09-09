import type { Metadata } from 'next';

import { MetricBars } from '../../../components/MetricBars.tsx';
import { playerHref } from '../../../lib/player-data.ts';
import { getPlayerRecordLeaders } from '../../../lib/player-intelligence.ts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Player records · Grudge Match',
  description: 'Career player records across Grudge drafts, trades and recovered weekly lineups.',
};

export default async function PlayerRecordsPage() {
  const records = await getPlayerRecordLeaders(12);

  return <>
    <a className="player-back" href="/players">← Players</a>
    <section className="page-hero compact-hero">
      <div className="eyebrow">The player ledger</div>
      <h1>Grudge player records</h1>
      <p>Who actually powered lineups, who kept getting drafted, and who could never stay put.</p>
    </section>

    <h2>Career starter points</h2>
    <p className="sub">Actual points contributed while starting in tracked Grudge games. Weekly lineup evidence survives from 2018 onward; consolation placement games are excluded.</p>
    <div className="card">
      <MetricBars rows={records.starterPoints.map((row) => ({
        key: row.player_key,
        label: `${row.full_name} · ${row.position}`,
        value: Number(row.points),
        display: `${Number(row.points).toFixed(1)} pts`,
        href: playerHref(row.player_key, row.latest_season),
        detail: `${row.starts} starts · ${row.seasons} season${row.seasons === 1 ? '' : 's'}`,
      }))} />
    </div>

    <h2>Most drafted</h2>
    <p className="sub">Every recovered Grudge draft from 2005 onward. The current season counts as soon as its draft board is captured.</p>
    <div className="card">
      <MetricBars rows={records.drafted.map((row) => ({
        key: row.player_key,
        label: `${row.full_name} · ${row.position}`,
        value: row.events,
        display: `${row.events} draft${row.events === 1 ? '' : 's'}`,
        href: playerHref(row.player_key, row.last_season),
        detail: `${row.first_season}–${row.last_season}`,
      }))} />
    </div>

    <h2>Most traded</h2>
    <p className="sub">Confirmed active trade packages in the recovered transaction era, 2018 onward. Drops, waivers and inferred pre-2018 ownership changes are not counted as trades.</p>
    <div className="card">
      <MetricBars rows={records.traded.map((row) => ({
        key: row.player_key,
        label: `${row.full_name} · ${row.position}`,
        value: row.events,
        display: `${row.events} trade${row.events === 1 ? '' : 's'}`,
        href: playerHref(row.player_key, row.last_season),
        detail: `${row.seasons} season${row.seasons === 1 ? '' : 's'} · ${row.first_season}–${row.last_season}`,
      }))} empty="No confirmed trades are available yet." />
    </div>

    <div className="callout" style={{ marginTop: 24 }}>
      <strong>Coverage matters:</strong> draft frequency is complete back to 2005, while career starter points and trade frequency begin where ESPN preserved player-level weekly evidence. The site does not backfill those gaps by inference.
    </div>
  </>;
}
