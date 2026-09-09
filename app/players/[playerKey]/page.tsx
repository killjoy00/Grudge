import { notFound, redirect } from 'next/navigation';
import { MetricBars } from '../../../components/MetricBars.tsx';
import { asPublic } from '../../../lib/db.ts';
import { PLAYER_CAREER_SQL, PLAYER_HISTORY_SQL } from '../../../lib/player-queries.ts';
import { getPlayerGrudgeSeasons } from '../../../lib/player-intelligence.ts';
import { decodePlayerKey, displayNumber, playerFilters, playerHref, PLAYER_STATS, statColumns,
  type PlayerProfile, type PlayerGame, type PlayerRow, type PlayerHistoryEvent, type PlayerImport } from '../../../lib/player-data.ts';
import { PlayerFilters } from '../../../components/PlayerFilters.tsx';
import { PlayerCoverage } from '../../../components/PlayerCoverage.tsx';
import { franchiseHref } from '../../../lib/history-format.ts';

export const dynamic = 'force-dynamic';
type Props = {params: Promise<{playerKey: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>};
const TEAM = (e: PlayerHistoryEvent) => e.team_name || `Team ${e.team_id}`;
function TimelineEvent({event: e}: {event: PlayerHistoryEvent}) {
  const team = e.franchise_key ? <a href={franchiseHref(e.franchise_key)}>{TEAM(e)}</a> : TEAM(e);
  const owner = e.managers ? ` · ${e.managers}` : '';
  return <li>
    <div className="player-event-date"><strong>{e.season}</strong><span>{e.week ? `Week ${e.week}${e.end_week && e.end_week !== e.week ? `–${e.end_week}` : ''}` : e.kind === 'draft' ? 'Draft' : 'Roster archive'}</span></div>
    <div>
      {e.kind === 'draft' && <><strong>Drafted by {team}</strong><span className="tsub block">{e.detail}{owner}</span></>}
      {e.kind === 'trade' && <><strong>Traded to {team}</strong><span className="tsub block">From {e.other_team_name || `Team ${e.other_team_id}`}{e.other_managers ? ` · ${e.other_managers}` : ''}</span>
        {e.managers && <span className="tsub block">Acquired by {e.managers}</span>}
        <a className="player-event-link" href={`/trades?season=${e.season}`}>View {e.season} trades</a> <span className="pill">Reconstructed · {e.evidence === 'ledger' ? 'ledger supported' : 'roster swap'}</span></>}
      {['add', 'waiver', 'drop'].includes(e.kind) && <><strong>{e.kind === 'drop' ? 'Dropped by ' : e.kind === 'waiver' ? 'Claimed on waivers by ' : 'Added by '}{team}</strong><span className="tsub block">Recorded transaction{owner}</span></>}
      {e.kind === 'roster' && <><strong>On {team}&rsquo;s roster</strong><span className="tsub block">Weekly roster snapshots{owner}</span></>}
      {['final_roster', 'current_roster'].includes(e.kind) && <><strong>On {team}&rsquo;s {e.kind === 'final_roster' ? 'final' : 'latest archived'} roster</strong><span className="tsub block">One roster snapshot{owner}</span></>}
      {e.occurred_at && <span className="tsub block">{new Date(e.occurred_at).toISOString().slice(0, 10)}{e.kind === 'trade' ? ' · acceptance recorded' : ' · execution recorded'}</span>}
    </div>
  </li>;
}

export default async function PlayerPage({params, searchParams}: Props) {
  const playerKey = decodePlayerKey((await params).playerKey);
  const archived = /^archive:(\d{4}):(-?\d+)$/.exec(playerKey);
  if (archived) {
    const [resolved] = await asPublic<{player_key: string}>(
      'select player_key from public.nfl_player_aliases where season=$1 and espn_player_id=$2', [Number(archived[1]), archived[2]]);
    if (resolved && resolved.player_key !== playerKey) redirect(playerHref(resolved.player_key, Number(archived[1])));
  }
  const [profile] = await asPublic<PlayerProfile>('select * from public.nfl_players where player_key=$1', [playerKey]);
  if (!profile) notFound();
  const filters = playerFilters(await searchParams);
  const [career, games, history, grudgeSeasons, coverageRows] = await Promise.all([
    asPublic<PlayerRow & {season: number}>(PLAYER_CAREER_SQL, [playerKey, filters.period]),
    asPublic<PlayerGame>(`select * from public.nfl_player_games where player_key=$1 and season=$2 and season_type=$3
      and week between $4 and $5 order by week`, [playerKey, filters.season, filters.period, filters.from, filters.to]),
    asPublic<PlayerHistoryEvent>(PLAYER_HISTORY_SQL, [playerKey]),
    getPlayerGrudgeSeasons(playerKey),
    asPublic<PlayerImport>('select * from public.nfl_player_imports where season=$1', [filters.season]),
  ]);
  const seasons = [...new Set([filters.season, ...career.map(s=>s.season)])].sort((a,b)=>b-a);
  const position = career.find(s=>s.season===filters.season)?.position || profile.position;
  const columns = statColumns(position);
  const total = games.length && games.every(g => g.fantasy_points !== null) ? games.reduce((sum,g)=>sum+Number(g.fantasy_points),0) : null;
  const label = (key: string) => PLAYER_STATS.find(([k])=>k===key)?.[1] ?? key.replaceAll('_', ' ');
  const grudgeStarts = grudgeSeasons.reduce((sum, row) => sum + row.starts, 0);
  const grudgePoints = grudgeSeasons.every((row) => row.points !== null)
    ? grudgeSeasons.reduce((sum, row) => sum + Number(row.points), 0)
    : null;
  const grudgeFranchises = new Set(grudgeSeasons.map((row) => row.franchise_key)).size;
  const drafts = history.filter((event) => event.kind === 'draft').length;
  const trades = history.filter((event) => event.kind === 'trade').length;

  return <>
    <a className="player-back" href={`/players?season=${filters.season}&position=${encodeURIComponent(position)}`}>← Players</a>
    <section className="page-hero compact-hero player-profile-hero"><div className="eyebrow">{position} · Player file</div>
      <h1>{profile.full_name}</h1><p>{[profile.bio.college_name, profile.bio.rookie_season ? `NFL debut ${profile.bio.rookie_season}` : null,
        profile.bio.height ? `${profile.bio.height} in · ${profile.bio.weight || '—'} lb` : null].filter(Boolean).join(' · ') || 'NFL stats and a career through Grudge Match.'}</p>
    </section>
    <nav className="player-sections" aria-label="Player sections"><a href="#game-log">Game log</a><a href="#seasons">Season totals</a><a href="#grudge-career">Grudge career</a><a href="#grudge-history">Transactions</a></nav>
    {playerKey.startsWith('archive:') && <p className="callout">This archived player identity has not been matched confidently to an NFL record. The league history below is preserved; NFL stats are withheld until the identity is resolved.</p>}
    <PlayerFilters key={JSON.stringify(filters)} filters={filters} seasons={seasons} profile />
    <div className="stat-strip three"><div><strong>{displayNumber(total, 2)}</strong><span>Points · selected weeks</span></div>
      <div><strong>{games.length || '—'}</strong><span>Games with stats</span></div>
      <div><strong>{drafts}</strong><span>Grudge drafts</span></div></div>
    <h2 id="game-log">{filters.season} game log</h2>
    <p className="sub">{filters.period === 'REG' ? 'NFL regular season' : 'NFL playoffs'} · Weeks {filters.from}–{filters.to}</p>
    {games.length ? <div className="card"><div className="scroll"><table className="player-game-table"><thead><tr><th>Week / opponent</th><th className="num">Points</th>
      {columns.map(k=><th className="num" key={k}>{label(k)}</th>)}</tr></thead><tbody>{games.map(g=><tr key={g.week}>
        <td><strong>W{g.week}</strong><span className="tsub block">{g.team} vs {g.opponent}</span></td>
        <td className="num"><strong>{displayNumber(g.fantasy_points, 2)}</strong><span className="tsub block">{g.score_evidence === 'observed' ? 'ESPN' : g.score_evidence === 'reconstructed' ? 'Rebuilt' : 'Unavailable'}</span></td>
        {columns.map(k=><td className="num" key={k}>{displayNumber(g.stats[k], 0)}</td>)}
      </tr>)}</tbody></table></div>
      <details className="player-raw-stats"><summary>All available game stats</summary>
        {games.map(g=><details key={g.week}><summary>Week {g.week} · {g.team} vs {g.opponent}</summary>
          <dl className="player-stat-grid">{Object.entries(g.stats).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=><div key={key}><dt>{label(key)}</dt><dd>{displayNumber(value, Number.isInteger(value) ? 0 : 2)}</dd></div>)}</dl>
        </details>)}
      </details>
    </div> : <div className="card empty-state"><strong>No NFL stat records in this range</strong><span>Choose a season from the career table below. Missing games and byes are not shown as zeroes.</span></div>}
    <h2 id="seasons">Season totals</h2><p className="sub">Full {filters.period === 'REG' ? 'NFL regular seasons' : 'NFL playoffs'}. Select a year to open its game log. Points use that year&rsquo;s Grudge rules.</p>
    <div className="card scroll"><table><thead><tr><th>Season</th><th className="num">Games*</th><th className="num">Points</th><th className="num">Avg</th>{columns.map(k=><th className="num" key={k}>{label(k)}</th>)}</tr></thead>
      <tbody>{career.map(s=><tr key={s.season}><td><a className="tname" href={`${playerHref(playerKey, s.season)}&period=${filters.period}#game-log`}>{s.season}</a><span className="tsub block">{s.teams.join(' / ')}</span></td>
        <td className="num">{s.games || '—'}</td><td className="num"><strong>{displayNumber(s.points, 2)}</strong></td><td className="num">{displayNumber(s.average, 2)}</td>
        {columns.map(k=><td className="num" key={k}>{displayNumber(s[k], 0)}</td>)}
      </tr>)}</tbody></table></div>

    <h2 id="grudge-career">Grudge career</h2>
    <p className="sub">Actual roster and starter contributions in tracked games. This section begins in 2018, when ESPN&rsquo;s weekly player-level lineups become recoverable.</p>
    {grudgeSeasons.length > 0 ? <>
      <div className="stat-strip">
        <div><strong>{grudgeStarts}</strong><span>Starts</span></div>
        <div><strong>{displayNumber(grudgePoints, 2)}</strong><span>Points started</span></div>
        <div><strong>{grudgeFranchises}</strong><span>Franchises</span></div>
        <div><strong>{drafts} / {trades}</strong><span>Drafts / trades</span></div>
      </div>
      <div className="card">
        <MetricBars rows={grudgeSeasons.map((row) => ({
          key: `${row.season}-${row.franchise_key}`,
          label: row.team_name,
          value: Number(row.points ?? 0),
          display: row.points === null ? 'Incomplete' : `${Number(row.points).toFixed(1)} pts`,
          href: franchiseHref(row.franchise_key),
          detail: `${row.season} · ${row.starts} start${row.starts === 1 ? '' : 's'} · ${row.roster_weeks} roster week${row.roster_weeks === 1 ? '' : 's'}`,
        }))} />
      </div>
    </> : <div className="card empty-state"><strong>No weekly Grudge lineup evidence</strong><span>This player may predate the recoverable 2018+ lineup archive or may never have appeared on a Grudge roster.</span></div>}

    <h2 id="grudge-history">Transactions &amp; ownership</h2><p className="sub">Drafts, transactions and observed ownership, with the managers from each season.</p>
    {history.length ? <ol className="card player-timeline">{history.map(e=><TimelineEvent key={e.event_key} event={e} />)}</ol>
      : <div className="card empty-state"><strong>No Grudge records found</strong><span>This player has no linked draft, transaction or roster record in the available archives.</span></div>}
    <PlayerCoverage coverage={coverageRows[0]} />
  </>;
}
