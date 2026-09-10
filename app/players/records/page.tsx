import type { Metadata } from 'next';

import { MetricBars } from '../../../components/MetricBars.tsx';
import { franchiseHref, seasonHref } from '../../../lib/history-format.ts';
import { playerHref } from '../../../lib/player-data.ts';
import { getPlayerRecordLeaders } from '../../../lib/player-intelligence.ts';
import { getTrackedTopPlayerWeeks } from '../../../lib/tracked-game-queries.ts';
import { POSITIONS } from '../../../pipeline/trade.ts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Player records · Grudge Match',
  description: 'Career and single-week player records across Grudge drafts, trades and recovered weekly lineups.',
};

export default async function PlayerRecordsPage() {
  const [records, topWeeks] = await Promise.all([
    getPlayerRecordLeaders(12),
    getTrackedTopPlayerWeeks(12),
  ]);

  return <>
    <a className="player-back" href="/history">← League history</a>
    <section className="page-hero compact-hero">
      <div className="eyebrow">The player ledger</div>
      <h1>Grudge player records</h1>
      <p>Biggest weeks, career workhorses, draft-room regulars and the players who could never stay put.</p>
    </section>

    <h2>Highest individual player weeks</h2>
    <p className="sub">Player-level lineup entries survive from 2018 onward. Bench performances are included and labeled; consolation placement games are excluded.</p>
    <div className="card"><div className="scroll"><table>
      <thead><tr><th>#</th><th>Player</th><th>Team</th><th className="num">Points</th><th>Week</th><th>Lineup</th></tr></thead>
      <tbody>{topWeeks.map((row, index) => (
        <tr key={`${row.season}-${row.week}-${row.player_key}`} className={index === 0 ? 'title-row' : undefined}>
          <td>{index + 1}</td>
          <td><a className="tname" href={playerHref(row.player_key, row.season)}>{row.full_name ?? `ESPN player #${row.espn_player_id}`}</a><span className="tsub block">{POSITIONS[row.default_position_id ?? 0] ?? '—'}</span></td>
          <td><a href={franchiseHref(row.franchise_key)}>{row.team}</a></td>
          <td className="num"><strong>{row.points}</strong></td>
          <td><a href={seasonHref(row.season)}>{row.season} wk {row.week}</a>{row.playoff_tier && <span className="tag era">postseason</span>}</td>
          <td>{row.is_starter ? 'Starter' : <span className="tag worst">Bench</span>}</td>
        </tr>
      ))}</tbody>
    </table></div></div>

    <h2>Career production</h2>
    <p className="sub">Actual points and starts contributed in tracked Grudge games. Weekly lineup evidence begins in 2018.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
      <div className="card">
        <strong>Career starter points</strong>
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
        <strong>Most career starts</strong>
        <div style={{ marginTop: 14 }}><MetricBars rows={records.mostStarts.map((row) => ({
          key: row.player_key,
          label: `${row.full_name} · ${row.position}`,
          value: row.starts,
          display: `${row.starts} starts`,
          href: playerHref(row.player_key, row.latest_season),
          detail: `${Number(row.points).toFixed(1)} starter pts · ${row.seasons} season${row.seasons === 1 ? '' : 's'}`,
        }))} /></div>
      </div>
    </div>

    <h2>Grudge journeymen</h2>
    <p className="sub">Most different permanent franchises a player has actually started for in the recoverable weekly era.</p>
    <div className="card">
      <MetricBars rows={records.mostFranchises.map((row) => ({
        key: row.player_key,
        label: `${row.full_name} · ${row.position}`,
        value: row.franchises,
        display: `${row.franchises} franchise${row.franchises === 1 ? '' : 's'}`,
        href: playerHref(row.player_key, row.latest_season),
        detail: `${row.starts} starts · ${row.seasons} season${row.seasons === 1 ? '' : 's'}`,
      }))} />
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginTop: 24 }}>
      <div>
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
      </div>
      <div>
        <h2>Most traded</h2>
        <p className="sub">Confirmed active trade packages in the recovered transaction era, 2018 onward. Drops and waivers are not trades.</p>
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
      </div>
    </div>

    <div className="callout" style={{ marginTop: 24 }}>
      <strong>Coverage matters:</strong> draft frequency is complete back to 2005, while weekly scores, starts, franchise counts and trade frequency begin where ESPN preserved player-level weekly evidence in 2018. The site does not backfill those gaps by inference.
    </div>
  </>;
}
