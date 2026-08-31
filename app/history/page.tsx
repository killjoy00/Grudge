import { getCachedHistory } from '../../lib/cached-queries.ts';

export const dynamic = 'force-dynamic';

function record(wins: number, losses: number, ties: number) {
  return `${wins}-${losses}${ties ? `-${ties}` : ''}`;
}

export default async function History() {
  const [espnEra, seasons, franchises, managers] = await getCachedHistory();
  const loadedYears = seasons.map((row) => row.season);
  const firstEspn = loadedYears.length ? Math.min(...loadedYears) : null;
  const lastEspn = loadedYears.length ? Math.max(...loadedYears) : null;
  const firstArchive = franchises.length
    ? Math.min(...franchises.map((row) => row.first_season))
    : null;
  const championships = franchises.reduce((sum, row) => sum + row.championships, 0);

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The permanent record</div>
        <h1>League history</h1>
        <p>Franchises endure. Team names change. Managers come, go, and occasionally return.</p>
      </div>

      <div className="stat-strip three">
        <div><strong>{firstArchive ?? firstEspn ?? '—'}</strong><span>First season loaded</span></div>
        <div><strong>{seasons.length}</strong><span>ESPN seasons</span></div>
        <div><strong>{championships || '—'}</strong><span>Archive titles</span></div>
      </div>

      <h2>Franchise record</h2>
      {franchises.length === 0 ? (
        <div className="callout">
          The 2005–2017 archive is checked in but has not been imported into
          this database yet. Run <code>npm run history:import</code> (see
          <code>docs/PRE-2018-HISTORY.md</code>) to fill in thirteen seasons of
          records, finishes, and championships.
</div>
      ) : (
        <div className="card">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="rank">#</th><th>Franchise</th>
                  <th className="num">Seasons</th><th className="num">Regular</th>
                  <th className="num">Playoffs</th><th className="num">Titles</th>
                </tr>
              </thead>
              <tbody>
                {franchises.map((row, index) => (
                  <tr key={row.franchise_key}>
                    <td className="rank">{index + 1}</td>
                    <td>
                      <span className="tname">{row.current_name}</span>
                      <span className="tsub block">{row.first_season}–{row.last_season}</span>
                    </td>
                    <td className="num">{row.seasons}</td>
                    <td className="num">{record(row.regular_wins, row.regular_losses, row.regular_ties)}</td>
                    <td className="num">{row.playoff_wins}-{row.playoff_losses}</td>
                    <td className="num">{row.championships}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {managers.length > 0 && (
        <>
          <h2>Manager record</h2>
          <div className="card">
            <div className="scroll">
              <table>
                <thead>
                  <tr><th>Manager</th><th className="num">Seasons</th>
                    <th className="num">Regular</th><th className="num">Playoffs</th>
                    <th className="num">Titles</th></tr>
                </thead>
                <tbody>
                  {managers.map((row) => (
                    <tr key={row.manager_key}>
                      <td className="tname">{row.display_name}</td>
                      <td className="num">{row.seasons}</td>
                      <td className="num">{record(row.regular_wins, row.regular_losses, row.regular_ties)}</td>
                      <td className="num">{row.playoff_wins}-{row.playoff_losses}</td>
                      <td className="num">{row.championships}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <h2>ESPN team-ID era</h2>
      <p className="sub">
        {firstEspn && lastEspn ? `${firstEspn}–${lastEspn}` : 'No ESPN seasons loaded'} · grouped by modern ESPN team ID
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
              {espnEra.map((row, index) => {
                const games = row.wins + row.losses + row.ties;
                return (
                  <tr key={row.espn_team_id}>
                    <td className="rank">{index + 1}</td>
                    <td><a href={`/team/${row.espn_team_id}`} className="tname">{row.name}</a></td>
                    <td className="num">{row.seasons}</td>
                    <td className="num">{record(row.wins, row.losses, row.ties)}</td>
                    <td className="num">{games ? ((row.wins + row.ties / 2) / games * 100).toFixed(1) : '—'}</td>
                    <td className="num">{Number(row.points_for).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">
          This table stays separate until every modern team ID has an explicit
          franchise mapping. That avoids silently assigning an old owner&rsquo;s record
          to the person who happens to use that ESPN slot today. The league did not play in 2020.
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
