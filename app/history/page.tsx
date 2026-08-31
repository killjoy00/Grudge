import SortableTable from '../../components/SortableTable.tsx';
import type { SortColumn, SortRow } from '../../components/SortableTable.tsx';
import { getCachedHistory } from '../../lib/cached-queries.ts';

export const dynamic = 'force-dynamic';

function record(wins: number, losses: number, ties: number) {
  return `${wins}-${losses}${ties ? `-${ties}` : ''}`;
}

/** Sorting a W-L record means sorting its win percentage, not its text. */
function rate(wins: number, losses: number, ties: number) {
  const games = wins + losses + ties;
  return games ? (wins + ties / 2) / games : 0;
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

/** The columns every record table shares, so franchise and manager stay aligned. */
function totalsCells(row: TotalsRow): SortRow['cells'] {
  return {
    seasons: { v: row.seasons },
    regular: {
      v: rate(row.regular_wins, row.regular_losses, row.regular_ties),
      d: record(row.regular_wins, row.regular_losses, row.regular_ties),
      note: `${(rate(row.regular_wins, row.regular_losses, row.regular_ties) * 100).toFixed(1)}%`,
    },
    playoffs: {
      v: rate(row.playoff_wins, row.playoff_losses, 0),
      d: `${row.playoff_wins}-${row.playoff_losses}`,
    },
    berths: { v: row.playoff_appearances },
    top4: { v: row.top_four },
    finals: { v: row.championships + row.runner_ups },
    titles: { v: row.championships },
  };
}

export default async function History() {
  const [espnEra, playedSeasons, franchises, managers, champions] = await getCachedHistory();
  const played = champions.length;
  const first = champions.length ? champions[champions.length - 1]!.season : null;
  const last = champions.length ? champions[0]!.season : null;

  // "Current" is whoever held a team in the most recent season on record.
  const currentManagers = managers.filter((row) => row.last_season === last);
  const formerManagers = managers.filter((row) => row.last_season !== last);

  const franchiseRows: SortRow[] = franchises.map((row) => ({
    key: row.franchise_key,
    cells: {
      name: {
        v: row.current_name,
        href: row.espn_team_id ? `/team/${row.espn_team_id}` : undefined,
        sub: `${row.first_season}–${row.last_season}`,
        note: row.title_seasons ? `🏆 ${row.title_seasons.split(' ').join(', ')}` : undefined,
      },
      ...totalsCells(row),
      points: {
        v: row.regular_points_for ? Number(row.regular_points_for) : 0,
        d: row.regular_points_for ? Number(row.regular_points_for).toLocaleString() : '—',
      },
    },
  }));

  const managerRows = (rows: typeof managers): SortRow[] => rows.map((row) => ({
    key: row.manager_key,
    cells: {
      name: {
        v: row.display_name,
        sub: `${row.first_season}–${row.last_season}`,
        note: row.title_seasons ? `🏆 ${row.title_seasons.split(' ').join(', ')}` : undefined,
      },
      ...totalsCells(row),
    },
  }));

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The permanent record</div>
        <h1>League history</h1>
        <p>Franchises endure. Team names change. Managers come, go, and occasionally return.</p>
      </div>

      {franchises.length === 0 ? (
        <div className="callout">
          The archive is checked in but has not been imported into this database
          yet. Run <code>npm run history:derive</code> then{' '}
          <code>npm run history:import</code> (see <code>docs/LEAGUE-HISTORY.md</code>)
          to load every season from 2005 on.
        </div>
      ) : (
        <>
          <div className="stat-strip three">
            <div>
              <strong>{first && last ? `${first}–${last}` : '—'}</strong>
              <span>Seasons on record</span>
            </div>
            <div><strong>{played}</strong><span>Seasons played</span></div>
            <div><strong>{franchises.length}</strong><span>Franchises</span></div>
          </div>

          <h2>By franchise</h2>
          <p className="sub">
            The durable entity, not the team name and not the person. Click any
            column to sort.
          </p>
          <div className="card">
            <SortableTable
              columns={[
                { key: 'name', label: 'Franchise' },
                ...RECORD_COLUMNS,
                { key: 'points', label: 'Points', numeric: true },
              ]}
              rows={franchiseRows}
            />
            <p className="note">
              Regular-season points only, so the 12-game 2005 season and the
              13-game seasons before 2021 sit below the modern 14-game years.
            </p>
          </div>

          <h2>By manager</h2>
          <p className="sub">
            Attributed person by person, so a franchise changing hands splits the
            record. {currentManagers.length} managers hold a team today.
          </p>
          <div className="card">
            <SortableTable
              columns={[{ key: 'name', label: 'Manager' }, ...RECORD_COLUMNS]}
              rows={managerRows(currentManagers)}
            />
          </div>

          {formerManagers.length > 0 && (
            <>
              <h3 style={{ marginTop: 26 }}>Former managers</h3>
              <p className="sub">Everyone who has held a franchise and moved on.</p>
              <div className="card">
                <SortableTable
                  columns={[{ key: 'name', label: 'Manager' }, ...RECORD_COLUMNS]}
                  rows={managerRows(formerManagers)}
                />
              </div>
            </>
          )}

          <h2>Champions</h2>
          <div className="card">
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="rank">Season</th><th>Champion</th>
                    <th>Runner-up</th><th className="num">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {champions.map((row) => (
                    <tr key={row.season}>
                      <td className="rank">
                        <a href={`/standings?season=${row.season}`}>{row.season}</a>
                      </td>
                      <td>
                        <span className="tname">{row.champion_name ?? '—'}</span>
                        {row.champion_team_name && row.champion_team_name !== row.champion_name && (
                          <span className="tsub block">as {row.champion_team_name}</span>
                        )}
                      </td>
                      <td>{row.runner_up_name ?? '—'}</td>
                      <td className="num">
                        <span className="tag era">{row.source === 'espn' ? 'ESPN' : 'archive'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              The league did not play in 2020. Seasons marked <em>archive</em> come
              from the commissioner&rsquo;s 2005–2017 spreadsheet; the rest are ESPN&rsquo;s
              own record.
            </p>
          </div>
        </>
      )}

      <h2>ESPN team-ID era</h2>
      <p className="sub">
        {playedSeasons.length ? `${playedSeasons.length} seasons` : 'No seasons'} of
        week-by-week ESPN data · grouped by modern ESPN team ID
      </p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th className="rank">#</th><th>Team</th><th className="num">Seasons</th>
                <th className="num">Record</th><th className="num">Win %</th><th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {espnEra.map((row, index) => (
                <tr key={row.espn_team_id}>
                  <td className="rank">{index + 1}</td>
                  <td><a href={`/team/${row.espn_team_id}`} className="tname">{row.name}</a></td>
                  <td className="num">{row.seasons}</td>
                  <td className="num">{record(row.wins, row.losses, row.ties)}</td>
                  <td className="num">{(rate(row.wins, row.losses, row.ties) * 100).toFixed(1)}</td>
                  <td className="num">{Number(row.points_for).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Counted from the loaded week-by-week results, playoff weeks included, so
          these totals are the raw ESPN feed rather than the franchise records
          above. Rivalries and weekly detail hang off these team IDs.
        </p>
      </div>
    </>
  );
}
