import { getCachedHistory } from '../../lib/cached-queries.ts';

export const dynamic = 'force-dynamic';

function record(wins: number, losses: number, ties: number) {
  return `${wins}-${losses}${ties ? `-${ties}` : ''}`;
}

function winPct(wins: number, losses: number, ties: number) {
  const games = wins + losses + ties;
  return games ? ((wins + ties / 2) / games * 100).toFixed(1) : '—';
}

/** "2005 2006 2007" reads as a title list; a bare count hides the dynasty. */
function titles(seasons: string | null) {
  if (!seasons) return null;
  return <span className="tsub block">{seasons.split(' ').join(', ')}</span>;
}

export default async function History() {
  const [espnEra, seasons, franchises, managers, champions] = await getCachedHistory();
  const played = champions.length;
  const first = champions.length ? champions[champions.length - 1]!.season : null;
  const last = champions.length ? champions[0]!.season : null;
  const espnSeasons = champions.filter((row) => row.source === 'espn').length;

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
            The durable entity, not the team name and not the person. Records span
            every season on file.
          </p>
          <div className="card">
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="rank">#</th><th>Franchise</th>
                    <th className="num">Seasons</th><th className="num">Regular</th>
                    <th className="num">Win %</th><th className="num">Playoffs</th>
                    <th className="num">Berths</th><th className="num">Finals</th>
                    <th className="num">Titles</th><th className="num">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {franchises.map((row, index) => (
                    <tr key={row.franchise_key}>
                      <td className="rank">{index + 1}</td>
                      <td>
                        {row.espn_team_id ? (
                          <a href={`/team/${row.espn_team_id}`} className="tname">{row.current_name}</a>
                        ) : (
                          <span className="tname">{row.current_name}</span>
                        )}
                        <span className="tsub block">{row.first_season}–{row.last_season}</span>
                        {titles(row.title_seasons)}
                      </td>
                      <td className="num">{row.seasons}</td>
                      <td className="num">{record(row.regular_wins, row.regular_losses, row.regular_ties)}</td>
                      <td className="num">{winPct(row.regular_wins, row.regular_losses, row.regular_ties)}</td>
                      <td className="num">{row.playoff_wins}-{row.playoff_losses}</td>
                      <td className="num">{row.playoff_appearances}</td>
                      <td className="num">{row.championships + row.runner_ups}</td>
                      <td className="num">{row.championships}</td>
                      <td className="num">
                        {row.regular_points_for
                          ? Number(row.regular_points_for).toLocaleString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              Regular-season points only, so the 12-game 2005 season and the
              13-game seasons before 2021 sit below the modern 14-game years.
            </p>
          </div>

          <h2>By manager</h2>
          <p className="sub">
            Attributed person by person, so a franchise changing hands splits the
            record. Co-owners each carry the seasons they shared.
          </p>
          <div className="card">
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="rank">#</th><th>Manager</th>
                    <th className="num">Seasons</th><th className="num">Regular</th>
                    <th className="num">Win %</th><th className="num">Playoffs</th>
                    <th className="num">Berths</th><th className="num">Finals</th>
                    <th className="num">Titles</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((row, index) => (
                    <tr key={row.manager_key}>
                      <td className="rank">{index + 1}</td>
                      <td>
                        <span className="tname">{row.display_name}</span>
                        <span className="tsub block">{row.first_season}–{row.last_season}</span>
                        {titles(row.title_seasons)}
                      </td>
                      <td className="num">{row.seasons}</td>
                      <td className="num">{record(row.regular_wins, row.regular_losses, row.regular_ties)}</td>
                      <td className="num">{winPct(row.regular_wins, row.regular_losses, row.regular_ties)}</td>
                      <td className="num">{row.playoff_wins}-{row.playoff_losses}</td>
                      <td className="num">{row.playoff_appearances}</td>
                      <td className="num">{row.championships + row.runner_ups}</td>
                      <td className="num">{row.championships}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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
                      <td className="rank">{row.season}</td>
                      <td>
                        <span className="tname">{row.champion_name ?? '—'}</span>
                        {row.champion_team_name && row.champion_team_name !== row.champion_name && (
                          <span className="tsub block">as {row.champion_team_name}</span>
                        )}
                      </td>
                      <td>{row.runner_up_name ?? '—'}</td>
                      <td className="num">{row.source === 'espn' ? 'ESPN' : 'archive'}</td>
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
        {espnSeasons ? `${espnSeasons} seasons` : 'No seasons'} of week-by-week
        ESPN data · grouped by modern ESPN team ID
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
                  <td className="num">{winPct(row.wins, row.losses, row.ties)}</td>
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

      <h2>Season books</h2>
      <div className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {seasons.map((season) => (
            <a key={season.season} href={`/standings?season=${season.season}`} className="btn">
              {season.season}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
