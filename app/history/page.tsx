import SortableTable from '../../components/SortableTable.tsx';
import type { SortColumn, SortRow } from '../../components/SortableTable.tsx';
import { getCachedHistory } from '../../lib/cached-queries.ts';
import { getCachedRichChampions } from '../../lib/history-cache.ts';
import { franchiseHref, managerHref, record, seasonHref, winRate } from '../../lib/history-format.ts';
import { getCachedRegularSeasonChampions } from '../../lib/regular-season-history.ts';
import { POSITIONS } from '../../pipeline/trade.ts';

export const dynamic = 'force-dynamic';

function roundName(tier: string) {
  return tier === 'WINNERS_BRACKET' ? 'Playoffs' : 'Consolation';
}

const RECORD_COLUMNS: SortColumn[] = [
  { key: 'seasons', label: 'Seasons', numeric: true },
  { key: 'regular', label: 'Regular', numeric: true, title: 'Sort by regular-season win %' },
  { key: 'playoffs', label: 'Playoffs', numeric: true, title: 'Sort by playoff win %' },
  { key: 'berths', label: 'Berths', numeric: true, title: 'Playoff appearances' },
  { key: 'top4', label: 'Top 4', numeric: true, title: 'Semifinal or better' },
  { key: 'finals', label: 'Finals', numeric: true, title: 'Championship games reached' },
  { key: 'titles', label: 'Titles', numeric: true },
];

interface TotalsRow {
  seasons: number;
  regular_wins: number; regular_losses: number; regular_ties: number;
  playoff_wins: number; playoff_losses: number;
  playoff_appearances: number; top_four: number;
  championships: number; runner_ups: number;
  title_seasons: string | null;
  first_season: number; last_season: number;
}

function totalsCells(row: TotalsRow): SortRow['cells'] {
  return {
    seasons: { v: row.seasons },
    regular: {
      v: winRate(row.regular_wins, row.regular_losses, row.regular_ties),
      d: record(row.regular_wins, row.regular_losses, row.regular_ties),
      note: `${(winRate(row.regular_wins, row.regular_losses, row.regular_ties) * 100).toFixed(1)}%`,
    },
    playoffs: {
      v: winRate(row.playoff_wins, row.playoff_losses),
      d: `${row.playoff_wins}-${row.playoff_losses}`,
    },
    berths: { v: row.playoff_appearances },
    top4: { v: row.top_four },
    finals: { v: row.championships + row.runner_ups },
    titles: { v: row.championships },
  };
}

export default async function History() {
  const [
    [espnEra, playedSeasons, franchises, managers, _oldChampions, topWeeks, topPlayers],
    champions,
    regularSeasonChampions,
  ] = await Promise.all([
    getCachedHistory(),
    getCachedRichChampions(),
    getCachedRegularSeasonChampions(),
  ]);
  const played = champions.length;
  const first = champions.length ? champions[champions.length - 1]!.season : null;
  const last = champions.length ? champions[0]!.season : null;
  const currentManagers = managers.filter((row) => row.last_season === last);
  const formerManagers = managers.filter((row) => row.last_season !== last);

  const regularTitlesByFranchise = new Map<string, number[]>();
  for (const row of [...regularSeasonChampions].reverse()) {
    const seasons = regularTitlesByFranchise.get(row.franchise_key) ?? [];
    seasons.push(row.season);
    regularTitlesByFranchise.set(row.franchise_key, seasons);
  }

  const franchiseRows: SortRow[] = franchises.map((row) => {
    const regularTitles = regularTitlesByFranchise.get(row.franchise_key) ?? [];
    return {
      key: row.franchise_key,
      cells: {
        name: {
          v: row.current_name,
          href: franchiseHref(row.franchise_key),
          sub: `${row.first_season}–${row.last_season}`,
          note: row.title_seasons ? `🏆 ${row.title_seasons.split(' ').join(', ')}` : undefined,
        },
        ...totalsCells(row),
        regTitles: {
          v: regularTitles.length,
          note: regularTitles.length ? `Won: ${regularTitles.join(', ')}` : undefined,
        },
        points: {
          v: row.regular_points_for ? Number(row.regular_points_for) : 0,
          d: row.regular_points_for ? Number(row.regular_points_for).toLocaleString() : '—',
        },
      },
    };
  });

  const managerRows = (rows: typeof managers): SortRow[] => rows.map((row) => ({
    key: row.manager_key,
    cells: {
      name: {
        v: row.display_name,
        href: managerHref(row.manager_key),
        sub: `${row.first_season}–${row.last_season}`,
        note: row.title_seasons ? `🏆 ${row.title_seasons.split(' ').join(', ')}` : undefined,
      },
      ...totalsCells(row),
    },
  }));

  const franchiseTitleCounts = new Map<string, number>();
  const managerTitleCounts = new Map<string, number>();
  const titleNumbers = new Map<number, { franchise: number; manager: number | null }>();
  for (const row of [...champions].reverse()) {
    const franchise = (franchiseTitleCounts.get(row.champion_key) ?? 0) + 1;
    franchiseTitleCounts.set(row.champion_key, franchise);
    let manager: number | null = null;
    if (row.champion_manager_key) {
      manager = (managerTitleCounts.get(row.champion_manager_key) ?? 0) + 1;
      managerTitleCounts.set(row.champion_manager_key, manager);
    }
    titleNumbers.set(row.season, { franchise, manager });
  }

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The permanent record</div>
        <h1>League history</h1>
        <p>Franchises endure. Team names change. Managers leave receipts.</p>
      </div>

      {franchises.length === 0 ? (
        <div className="callout">
          The archive is checked in but has not been imported into this database yet.
        </div>
      ) : (
        <>
          <div className="stat-strip three">
            <div><strong>{first && last ? `${first}–${last}` : '—'}</strong><span>Seasons on record</span></div>
            <div><strong>{played}</strong><span>Seasons played</span></div>
            <div><strong>{franchises.length}</strong><span>Franchises</span></div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0 28px' }}>
            <a className="btn" href="/history/records">Open the record book</a>
            {last && <a className="btn btn-quiet" href={seasonHref(last)}>Latest completed season</a>}
          </div>

          <h2>By franchise</h2>
          <p className="sub">The permanent league slots. Regular-season titles use the same standings rule as the season pages: win percentage, then points scored.</p>
          <div className="card">
            <SortableTable
              columns={[
                { key: 'name', label: 'Franchise' },
                { key: 'seasons', label: 'Seasons', numeric: true },
                { key: 'regular', label: 'Regular', numeric: true, title: 'Sort by regular-season win %' },
                { key: 'regTitles', label: 'Reg. titles', numeric: true, title: 'Regular-season championships' },
                { key: 'playoffs', label: 'Playoffs', numeric: true, title: 'Sort by playoff win %' },
                { key: 'berths', label: 'Berths', numeric: true, title: 'Playoff appearances' },
                { key: 'top4', label: 'Top 4', numeric: true, title: 'Semifinal or better' },
                { key: 'finals', label: 'Finals', numeric: true, title: 'Championship games reached' },
                { key: 'titles', label: 'Titles', numeric: true },
                { key: 'points', label: 'Points', numeric: true },
              ]}
              rows={franchiseRows}
            />
            <p className="note">Raw regular-season points are shown here; cross-era scoring comparisons live in the record book as points per game.</p>
          </div>

          <h2>By manager</h2>
          <p className="sub">Every manager is its own career now. Open a name for the year-by-year file.</p>
          <div className="card">
            <SortableTable columns={[{ key: 'name', label: 'Manager' }, ...RECORD_COLUMNS]} rows={managerRows(currentManagers)} />
          </div>

          <h2>Championship roll</h2>
          <p className="sub">The title history with the team name, manager, regular-season record and championship result where ESPN has the score.</p>
          <div className="card">
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Season</th><th>Champion</th><th>Manager</th><th className="num">Regular</th><th>Runner-up</th><th className="num">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {champions.map((row) => {
                    const numbers = titleNumbers.get(row.season)!;
                    return (
                      <tr key={row.season}>
                        <td><a className="tname" href={seasonHref(row.season)}>{row.season}</a></td>
                        <td>
                          <a className="tname" href={franchiseHref(row.champion_key)}>{row.champion_name}</a>
                          {row.champion_team_name !== row.champion_name && <span className="tsub block">as {row.champion_team_name}</span>}
                          <span className="tsub block">
                            {numbers.franchise === 1 ? 'First franchise title' : `Franchise title #${numbers.franchise}`}
                          </span>
                        </td>
                        <td>
                          {row.champion_manager_key && row.champion_manager ? (
                            <>
                              <a href={managerHref(row.champion_manager_key)}>{row.champion_manager}</a>
                              {numbers.manager && <span className="tsub block">Manager title #{numbers.manager}</span>}
                            </>
                          ) : '—'}
                        </td>
                        <td className="num">{record(row.champion_wins, row.champion_losses, row.champion_ties)}</td>
                        <td>
                          {row.runner_up_key && row.runner_up_name ? <a href={franchiseHref(row.runner_up_key)}>{row.runner_up_name}</a> : '—'}
                          {row.runner_up_manager_key && row.runner_up_manager && (
                            <span className="tsub block"><a href={managerHref(row.runner_up_manager_key)}>{row.runner_up_manager}</a></span>
                          )}
                        </td>
                        <td className="num">
                          {row.champion_score && row.runner_up_score ? <strong>{row.champion_score}–{row.runner_up_score}</strong> : <span className="tag era">{row.source === 'espn' ? 'ESPN' : 'archive'}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="note">The league did not play in 2020. Pre-2018 championship scores are unavailable because the commissioner archive records season totals and finish order rather than weekly games.</p>
          </div>
        </>
      )}

      {topWeeks.length > 0 && (
        <>
          <h2>Biggest weeks</h2>
          <p className="sub">The ten highest team scores on file, playoffs included. ESPN era only.</p>
          <div className="card">
            <div className="scroll">
              <table>
                <thead><tr><th className="rank">#</th><th>Team</th><th className="num">Points</th><th>Week</th><th>Opponent</th></tr></thead>
                <tbody>
                  {topWeeks.map((row, index) => (
                    <tr key={`${row.season}-${row.week}-${row.espn_team_id}`} className={index === 0 ? 'title-row' : undefined}>
                      <td className="rank">{index + 1}</td>
                      <td><a href={`/team/${row.espn_team_id}`} className="tname">{row.name}</a></td>
                      <td className="num"><strong>{row.points}</strong></td>
                      <td>
                        <a href={seasonHref(row.season)}>{row.season} wk {row.week}</a>
                        {row.playoff_tier && <span className="tsub block">{roundName(row.playoff_tier)}</span>}
                      </td>
                      <td>{row.opponent ?? '—'}<span className="tsub block">{row.points_against}{row.result === 'L' && ' — and lost'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {topPlayers.length > 0 && (
        <>
          <h2>Biggest individual weeks</h2>
          <p className="sub">The ten best player performances on file, playoffs included. ESPN era only.</p>
          <div className="card">
            <div className="scroll">
              <table>
                <thead><tr><th className="rank">#</th><th>Player</th><th className="num">Points</th><th>Week</th><th>Rostered by</th></tr></thead>
                <tbody>
                  {topPlayers.map((row, index) => (
                    <tr key={`${row.season}-${row.week}-${row.espn_player_id}`} className={index === 0 ? 'title-row' : undefined}>
                      <td className="rank">{index + 1}</td>
                      <td><span className="tname">{row.full_name ?? 'Unknown player'}</span><span className="tsub block">{POSITIONS[row.default_position_id ?? 0] ?? '—'}</span></td>
                      <td className="num"><strong>{row.points}</strong></td>
                      <td>
                        <a href={seasonHref(row.season)}>{row.season} wk {row.week}</a>
                        {row.playoff_tier && <span className="tsub block">{roundName(row.playoff_tier)}</span>}
                      </td>
                      <td>
                        <a href={`/team/${row.espn_team_id}`} className="tname">{row.team}</a>
                        {!row.is_starter && <span className="tag era">benched</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <h2>ESPN-era raw record</h2>
      <p className="sub">{playedSeasons.length} seasons of week-by-week data, grouped by modern ESPN team ID. This powers rivalry and weekly detail.</p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead><tr><th className="rank">#</th><th>Team</th><th className="num">Seasons</th><th className="num">Record</th><th className="num">Win %</th><th className="num">Points</th></tr></thead>
            <tbody>
              {espnEra.map((row, index) => (
                <tr key={row.espn_team_id}>
                  <td className="rank">{index + 1}</td>
                  <td><a href={`/team/${row.espn_team_id}`} className="tname">{row.name}</a></td>
                  <td className="num">{row.seasons}</td>
                  <td className="num">{record(row.wins, row.losses, row.ties)}</td>
                  <td className="num">{(winRate(row.wins, row.losses, row.ties) * 100).toFixed(1)}</td>
                  <td className="num">{Number(row.points_for).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {formerManagers.length > 0 && (
        <>
          <h2>Former managers</h2>
          <p className="sub">Everyone who has held a franchise and moved on.</p>
          <div className="card">
            <SortableTable columns={[{ key: 'name', label: 'Manager' }, ...RECORD_COLUMNS]} rows={managerRows(formerManagers)} />
          </div>
        </>
      )}
    </>
  );
}
