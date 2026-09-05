import { HistoryNav } from '../../components/HistoryNav.tsx';
import { getCachedRichChampions } from '../../lib/history-cache.ts';
import { franchiseHref, managerHref, record, seasonHref, winRate } from '../../lib/history-format.ts';
import { getCachedHistoryDirectory } from '../../lib/history-overview-cache.ts';
import { getCachedRegularSeasonChampions } from '../../lib/regular-season-history.ts';

export const dynamic = 'force-dynamic';

export default async function History() {
  const [[franchises, managers], champions, regularSeasonChampions] = await Promise.all([
    getCachedHistoryDirectory(),
    getCachedRichChampions(),
    getCachedRegularSeasonChampions(),
  ]);
  const first = champions.at(-1)?.season ?? null;
  const last = champions[0]?.season ?? null;
  const currentManagers = new Set(managers.filter((row) => row.last_season === last).map((row) => row.manager_key));
  const regularBySeason = new Map(regularSeasonChampions.map((row) => [row.season, row]));

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The permanent record</div>
        <h1>League history</h1>
        <p>Seasons, franchises and managers are the directory. Records, rivalries and raw ESPN evidence each have their own book.</p>
      </div>

      <HistoryNav current="overview" />

      <div className="stat-strip">
        <div><strong>{first && last ? `${first}–${last}` : '—'}</strong><span>League span</span></div>
        <div><strong>{champions.length}</strong><span>Seasons played</span></div>
        <div><strong>{franchises.length}</strong><span>Permanent franchises</span></div>
        <div><strong>{managers.length}</strong><span>Managers on record</span></div>
      </div>

      <h2>Choose a history book</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <a className="card" href="/history/records" style={{ textDecoration: 'none' }}>
          <span className="eyebrow">Records</span><h3>Who owns the marks?</h3>
          <p className="note">Best seasons, scoring records, power champions, luck extremes and individual-week records.</p>
        </a>
        <a className="card" href="/history/rivalries" style={{ textDecoration: 'none' }}>
          <span className="eyebrow">Rivalries</span><h3>Who owns whom?</h3>
          <p className="note">Every recovered head-to-head series, including the playoffs, back to 2005.</p>
        </a>
        <a className="card" href="/history/vault" style={{ textDecoration: 'none' }}>
          <span className="eyebrow">The Vault</span><h3>Show the receipts.</h3>
          <p className="note">Raw weekly scoreboards, draft boards, transaction coverage and the exact limits of the ESPN archive.</p>
        </a>
        <a className="card" href="/rankings" style={{ textDecoration: 'none' }}>
          <span className="eyebrow">Power rankings</span><h3>Same model, every era.</h3>
          <p className="note">The current 40/30/20/10 formula reconstructed from weekly scores back to 2005.</p>
        </a>
      </div>

      <h2>Franchises</h2>
      <p className="sub">A franchise is the permanent league slot. Names and managers can change without resetting the record.</p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Franchise</th><th className="num">Seasons</th><th className="num">Regular</th><th className="num">Win %</th><th className="num">Playoffs</th><th className="num">Titles</th></tr>
            </thead>
            <tbody>
              {franchises.map((row) => (
                <tr key={row.franchise_key}>
                  <td>
                    <a className="tname" href={franchiseHref(row.franchise_key)}>{row.current_name}</a>
                    <span className="tsub block">{row.first_season}–{row.last_season}</span>
                  </td>
                  <td className="num">{row.seasons}</td>
                  <td className="num">{record(row.regular_wins, row.regular_losses, row.regular_ties)}</td>
                  <td className="num">{(winRate(row.regular_wins, row.regular_losses, row.regular_ties) * 100).toFixed(1)}</td>
                  <td className="num">{row.playoff_wins}-{row.playoff_losses}<span className="tsub block">{row.playoff_appearances} berths</span></td>
                  <td className="num"><strong>{row.championships}</strong>{row.title_seasons && <span className="tsub block">{row.title_seasons}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>Managers</h2>
      <p className="sub">Career records follow the person across franchise changes; current and former managers stay in one directory.</p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Manager</th><th>Status</th><th className="num">Seasons</th><th className="num">Regular</th><th className="num">Win %</th><th className="num">Playoffs</th><th className="num">Titles</th></tr>
            </thead>
            <tbody>
              {managers.map((row) => (
                <tr key={row.manager_key}>
                  <td><a className="tname" href={managerHref(row.manager_key)}>{row.display_name}</a><span className="tsub block">{row.first_season}–{row.last_season}</span></td>
                  <td>{currentManagers.has(row.manager_key) ? <span className="tag best">Current</span> : <span className="tsub">Former</span>}</td>
                  <td className="num">{row.seasons}</td>
                  <td className="num">{record(row.regular_wins, row.regular_losses, row.regular_ties)}</td>
                  <td className="num">{(winRate(row.regular_wins, row.regular_losses, row.regular_ties) * 100).toFixed(1)}</td>
                  <td className="num">{row.playoff_wins}-{row.playoff_losses}<span className="tsub block">{row.playoff_appearances} berths</span></td>
                  <td className="num"><strong>{row.championships}</strong>{row.title_seasons && <span className="tsub block">{row.title_seasons}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>Season archive</h2>
      <p className="sub">Commissioner standings remain authoritative for 2005–2017 finishes; recovered ESPN scoreboards now supply the week-by-week evidence behind them.</p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead><tr><th>Season</th><th>League champion</th><th>Regular-season champion</th><th>Runner-up</th><th>Source</th></tr></thead>
            <tbody>
              {champions.map((row) => {
                const regular = regularBySeason.get(row.season);
                return (
                  <tr key={row.season}>
                    <td><a className="tname" href={seasonHref(row.season)}>{row.season}</a></td>
                    <td>
                      <a href={franchiseHref(row.champion_key)}>{row.champion_team_name}</a>
                      {row.champion_manager_key && row.champion_manager && <span className="tsub block"><a href={managerHref(row.champion_manager_key)}>{row.champion_manager}</a></span>}
                    </td>
                    <td>{regular ? <a href={franchiseHref(regular.franchise_key)}>{regular.team_name}</a> : '—'}</td>
                    <td>{row.runner_up_key && row.runner_up_team_name ? <a href={franchiseHref(row.runner_up_key)}>{row.runner_up_team_name}</a> : '—'}</td>
                    <td><span className="tsub">{row.source === 'manual' ? 'Commissioner finish + ESPN weekly evidence' : 'ESPN archive'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
