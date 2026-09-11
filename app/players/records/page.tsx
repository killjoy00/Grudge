import type { Metadata } from 'next';

import { franchiseHref, seasonHref } from '../../../lib/history-format.ts';
import { playerHref } from '../../../lib/player-data.ts';
import { getCachedPlayerRecordLeaders } from '../../../lib/cached-queries.ts';
import { getTrackedTopPlayerWeeks } from '../../../lib/tracked-game-queries.ts';
import { POSITIONS } from '../../../pipeline/trade.ts';

// Stays force-dynamic on purpose: this is a static route, so a revalidate
// window would make Next prerender it and the build would need a live
// database credential, which this project deliberately avoids. The caching
// comes from getCachedPlayerRecordLeaders, whose data cache applies here too.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Player records · Grudge Match',
  description: 'Career and single-week player records across Grudge drafts, reconstructed season-ending rosters, trades and recovered weekly lineups.',
};

export default async function PlayerRecordsPage() {
  const [records, topWeeks] = await Promise.all([
    getCachedPlayerRecordLeaders(12),
    getTrackedTopPlayerWeeks(12),
  ]);

  return <>
    <a className="player-back" href="/history">← League history</a>
    <section className="page-hero compact-hero">
      <div className="eyebrow">The player ledger</div>
      <h1>Grudge player records</h1>
      <p>Biggest weeks, career workhorses, reconstructed roster mainstays, draft-room regulars and the players who could never stay put.</p>
    </section>

    <h2>Highest individual player weeks</h2>
    <p className="sub">Player-level Grudge lineup entries survive from 2018 onward. Bench performances are included and labeled; consolation placement games are excluded.</p>
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

    <h2>Career starter points</h2>
    <p className="sub">Actual points contributed as a starter in tracked Grudge games. Weekly lineup evidence begins in 2018.</p>
    <div className="card"><div className="scroll"><table>
      <thead><tr><th>#</th><th>Player</th><th className="num">Points</th><th className="num">Starts</th><th className="num">Seasons</th></tr></thead>
      <tbody>{records.starterPoints.map((row, index) => (
        <tr key={row.player_key} className={index === 0 ? 'title-row' : undefined}>
          <td>{index + 1}</td>
          <td><a className="tname" href={playerHref(row.player_key, row.latest_season)}>{row.full_name}</a><span className="tsub block">{row.position}</span></td>
          <td className="num"><strong>{Number(row.points).toFixed(1)}</strong></td>
          <td className="num">{row.starts}</td>
          <td className="num">{row.seasons}</td>
        </tr>
      ))}</tbody>
    </table></div></div>

    <h2>Most career starts</h2>
    <p className="sub">Most tracked Grudge starts since player-level weekly lineup evidence begins in 2018.</p>
    <div className="card"><div className="scroll"><table>
      <thead><tr><th>#</th><th>Player</th><th className="num">Starts</th><th className="num">Points</th><th className="num">Seasons</th></tr></thead>
      <tbody>{records.mostStarts.map((row, index) => (
        <tr key={row.player_key} className={index === 0 ? 'title-row' : undefined}>
          <td>{index + 1}</td>
          <td><a className="tname" href={playerHref(row.player_key, row.latest_season)}>{row.full_name}</a><span className="tsub block">{row.position}</span></td>
          <td className="num"><strong>{row.starts}</strong></td>
          <td className="num">{Number(row.points).toFixed(1)}</td>
          <td className="num">{row.seasons}</td>
        </tr>
      ))}</tbody>
    </table></div></div>

    <h2>Season-ending roster mainstays</h2>
    <p className="sub">Most completed Grudge seasons appearing on the reconstructed season-ending roster snapshot. This archive reaches back to 2005 and does not imply that the player started every week—or at all—for that team.</p>
    <div className="card"><div className="scroll"><table>
      <thead><tr><th>#</th><th>Player</th><th className="num">Roster seasons</th><th>Span</th></tr></thead>
      <tbody>{records.archiveRosterSeasons.map((row, index) => (
        <tr key={row.player_key} className={index === 0 ? 'title-row' : undefined}>
          <td>{index + 1}</td>
          <td><a className="tname" href={playerHref(row.player_key, row.last_season)}>{row.full_name}</a><span className="tsub block">{row.position}</span></td>
          <td className="num"><strong>{row.events}</strong></td>
          <td>{row.first_season}–{row.last_season}</td>
        </tr>
      ))}</tbody>
    </table></div></div>

    <h2>Championship season-ending rosters</h2>
    <p className="sub">Players appearing on the champion&rsquo;s reconstructed season-ending roster, 2005 onward. This is roster membership, not a claim about starts or championship-game contribution.</p>
    <div className="card"><div className="scroll"><table>
      <thead><tr><th>#</th><th>Player</th><th className="num">Title rosters</th><th>Span</th></tr></thead>
      <tbody>{records.championshipRosters.map((row, index) => (
        <tr key={row.player_key} className={index === 0 ? 'title-row' : undefined}>
          <td>{index + 1}</td>
          <td><a className="tname" href={playerHref(row.player_key, row.last_season)}>{row.full_name}</a><span className="tsub block">{row.position}</span></td>
          <td className="num"><strong>{row.events}</strong></td>
          <td>{row.first_season}–{row.last_season}</td>
        </tr>
      ))}</tbody>
    </table></div></div>

    <h2>Grudge journeymen</h2>
    <p className="sub">Most different permanent franchises a player has actually started for in the recoverable weekly era. Team defenses are excluded.</p>
    <div className="card"><div className="scroll"><table>
      <thead><tr><th>#</th><th>Player</th><th className="num">Franchises</th><th className="num">Starts</th><th className="num">Seasons</th></tr></thead>
      <tbody>{records.mostFranchises.map((row, index) => (
        <tr key={row.player_key} className={index === 0 ? 'title-row' : undefined}>
          <td>{index + 1}</td>
          <td><a className="tname" href={playerHref(row.player_key, row.latest_season)}>{row.full_name}</a><span className="tsub block">{row.position}</span></td>
          <td className="num"><strong>{row.franchises}</strong></td>
          <td className="num">{row.starts}</td>
          <td className="num">{row.seasons}</td>
        </tr>
      ))}</tbody>
    </table></div></div>

    <h2>Most drafted</h2>
    <p className="sub">Every recovered Grudge draft from 2005 onward. The current season counts as soon as its draft board is captured.</p>
    <div className="card"><div className="scroll"><table>
      <thead><tr><th>#</th><th>Player</th><th className="num">Drafts</th><th className="num">Seasons</th><th>Span</th></tr></thead>
      <tbody>{records.drafted.map((row, index) => (
        <tr key={row.player_key} className={index === 0 ? 'title-row' : undefined}>
          <td>{index + 1}</td>
          <td><a className="tname" href={playerHref(row.player_key, row.last_season)}>{row.full_name}</a><span className="tsub block">{row.position}</span></td>
          <td className="num"><strong>{row.events}</strong></td>
          <td className="num">{row.seasons}</td>
          <td>{row.first_season}–{row.last_season}</td>
        </tr>
      ))}</tbody>
    </table></div></div>

    <h2>Most traded</h2>
    <p className="sub">Confirmed active trade packages in the recovered transaction era, 2018 onward. Drops and waivers are not trades.</p>
    <div className="card"><div className="scroll"><table>
      <thead><tr><th>#</th><th>Player</th><th className="num">Trades</th><th className="num">Seasons</th><th>Span</th></tr></thead>
      <tbody>{records.traded.length > 0 ? records.traded.map((row, index) => (
        <tr key={row.player_key} className={index === 0 ? 'title-row' : undefined}>
          <td>{index + 1}</td>
          <td><a className="tname" href={playerHref(row.player_key, row.last_season)}>{row.full_name}</a><span className="tsub block">{row.position}</span></td>
          <td className="num"><strong>{row.events}</strong></td>
          <td className="num">{row.seasons}</td>
          <td>{row.first_season}–{row.last_season}</td>
        </tr>
      )) : <tr><td colSpan={5}>No confirmed trades are available yet.</td></tr>}</tbody>
    </table></div></div>

    <div className="callout" style={{ marginTop: 24 }}>
      <strong>Coverage matters:</strong> the reconstructed season-ending roster archive and draft archive reach back to 2005. Reconstructed NFL weekly scoring also reaches 2005 and 2007–2017, but weekly Grudge ownership and lineup slots do not. For that reason, starter points, starts, highest Grudge weeks, franchise-start counts and trade frequency remain anchored to the 2018+ evidence era rather than being inferred backward.
    </div>
  </>;
}
