import type { Metadata } from 'next';
import { asPublic } from '../../lib/db.ts';
import { playerFilters, playerFilterHref, currentNflSeason, type PlayerRow, type PlayerImport } from '../../lib/player-data.ts';
import { playerListQuery } from '../../lib/player-queries.ts';
import { PlayerFilters } from '../../components/PlayerFilters.tsx';
import { PlayerStatsTable } from '../../components/PlayerStatsTable.tsx';
import { PlayerCoverage } from '../../components/PlayerCoverage.tsx';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Players · Grudge Match', description: 'Every NFL fantasy player, every week. Explore statistics, Grudge fantasy points, and league history.'};

export default async function PlayersPage({ searchParams }: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const filters = playerFilters(await searchParams);
  const query = playerListQuery(filters);
  const [players, imports] = await Promise.all([
    asPublic<PlayerRow>(query.text, query.params),
    asPublic<PlayerImport>('select * from public.nfl_player_imports order by season desc'),
  ]);
  const coverage = imports.find(s => s.season === filters.season);
  const seasons = [...new Set([currentNflSeason(), ...imports.map(s => s.season)])].sort((a,b)=>b-a);
  const count = players[0]?.total_count ?? 0;
  return <>
    <section className="page-hero compact-hero"><div className="eyebrow">The player ledger</div>
      <h1>Every player. Every chapter.</h1><p>NFL production and the Grudge history behind it. Find a player, compare a stretch of weeks, or follow a career through the league.</p>
      <p style={{ marginTop: 14 }}><a className="btn btn-quiet" href="/players/records">Grudge player records →</a></p>
    </section>
    <PlayerFilters key={JSON.stringify(filters)} filters={filters} seasons={seasons} />
    <div className="player-results-heading"><div><h2>{filters.season} {filters.position || 'All players'}</h2>
      <p className="sub">{filters.period === 'REG' ? 'NFL regular season' : 'NFL playoffs'} · Weeks {filters.from}–{filters.to} · {count.toLocaleString('en-US')} players</p></div>
      {coverage?.status === 'complete' && <span className="pill w">Season on file</span>}
    </div>
    {(!coverage || coverage.status === 'awaiting_games') && <div className="callout">
      <strong>No completed-game stats published for {filters.season} yet.</strong> The player directory is ready; scores will appear after the NFL feed updates.
      {' '}<a href={playerFilterHref(filters, {season: filters.season - 1, page: 1})}>Browse last season</a>.
    </div>}
    {filters.season < 2005 && <p className="callout">NFL stats are available here. Grudge fantasy scoring begins in 2005.</p>}
    <div className="card player-results">
      {players.length ? <PlayerStatsTable players={players} filters={filters} /> : <div className="empty-state">
        <strong>No matching players</strong><span>Try a different name, position or season.</span><a href="/players">Reset filters</a>
      </div>}
    </div>
    <nav className="player-pagination" aria-label="Player pages">
      {filters.page > 1 && <a className="btn btn-quiet" href={playerFilterHref(filters, {page: filters.page - 1})}>← Previous</a>}
      <span>Page {filters.page}{count ? ` of ${Math.ceil(count / 50)}` : ''}</span>
      {filters.page * 50 < count && <a className="btn" href={playerFilterHref(filters, {page: filters.page + 1})}>Next →</a>}
    </nav>
    <p className="note">Points and stats are totals for the selected weeks. Open a player for their game log and Grudge history. On a phone, swipe the table to see more stats.</p>
    <PlayerCoverage coverage={coverage} />
  </>;
}
