import { getCachedPlayedSeasons, getCachedStandings } from '../../lib/cached-queries.ts';

// Render after deployment, then cache the underlying public data for an hour.
export const dynamic = 'force-dynamic';

export default async function Standings({
  searchParams,
}: { searchParams: Promise<{ season?: string }> }) {
  const seasons = await getCachedPlayedSeasons();
  const sp = await searchParams;
  const season = Number(sp.season) || seasons[0]?.season;
  if (!season) return <p className="empty">No completed seasons yet.</p>;

  const [rows, luck] = await getCachedStandings(season);
  const luckBy = new Map(luck.map((l) => [l.espn_team_id, l]));
  const playoffLine = 6;

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">{season} season</div>
        <h1>The table</h1>
        <p>Seeding breaks ties by total points scored—the league&rsquo;s own rule.</p>
      </div>

      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th className="rank">#</th>
                <th>Team</th>
                <th className="num">W-L</th>
                <th className="num">PF</th>
                <th className="num">PA</th>
                <th className="num">Luck</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const l = luckBy.get(r.espn_team_id);
                const delta = l ? Number(l.luck_delta) : 0;
                return (
                  <tr key={r.espn_team_id}
                      style={i === playoffLine - 1 ? { borderBottom: '2px solid var(--accent)' } : undefined}>
                    <td className="rank">{i + 1}</td>
                    <td>
                      <a href={`/team/${r.espn_team_id}`} className="tname">{r.name}</a>
                    </td>
                    <td className="num">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</td>
                    <td className="num">{r.points_for}</td>
                    <td className="num">{r.points_against}</td>
                    <td className="num">
                      {l ? (
                        <span className={`pill ${delta > 0.5 ? 'warn' : delta < -0.5 ? 'l' : ''}`}>
                          {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 12 }}>
          The blue line is the playoff cut (top {playoffLine} of {rows.length}).
          <strong> Luck</strong> is wins above or below what your weekly scores earned
          against the whole league — positive means the schedule was kind.
        </p>
      </div>

      {seasons.length > 1 && (
        <div className="card">
          <strong style={{ fontSize: 14 }}>Other seasons</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {seasons.map((s) => (
              <a key={s.season} href={`/standings?season=${s.season}`}
                 className="btn" style={{ padding: '6px 12px' }}>
                {s.season}
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
