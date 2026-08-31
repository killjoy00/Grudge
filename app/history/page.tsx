import { getCachedHistory } from '../../lib/cached-queries.ts';

// Defer the first database read until a request reaches the deployment. A
// static render made every build depend on Neon being reachable and on the
// runtime credential already being perfect, so an otherwise valid deploy
// failed while prerendering /history. The data itself is still cached for a
// day; only the timing of the first read changes.
export const dynamic = 'force-dynamic';

export default async function History() {
  const [all, seasons] = await getCachedHistory();

  return (
    <>
      <h1>All-time</h1>
      <p className="sub">
        {seasons.length} seasons on record ({seasons[seasons.length - 1]?.season}–{seasons[0]?.season})
      </p>

      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th className="rank">#</th>
                <th>Team</th>
                <th className="num">Seasons</th>
                <th className="num">Record</th>
                <th className="num">Win %</th>
                <th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r, i) => {
                const g = r.wins + r.losses + r.ties;
                return (
                  <tr key={r.espn_team_id}>
                    <td className="rank">{i + 1}</td>
                    <td><a href={`/team/${r.espn_team_id}`} className="tname">{r.name}</a></td>
                    <td className="num">{r.seasons}</td>
                    <td className="num">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</td>
                    <td className="num">{g ? ((r.wins + r.ties / 2) / g * 100).toFixed(1) : '—'}</td>
                    <td className="num">{Number(r.points_for).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="note">
          Records cover {seasons[seasons.length - 1]?.season} onward, which is as far
          back as ESPN&rsquo;s API serves this league. <strong>2020 is absent because the
          league did not play that year.</strong> Earlier seasons exist but can only be
          recovered from screenshots — see <code>docs/PRE-2018-HISTORY.md</code>.
        </p>
      </div>

      <h2>Seasons</h2>
      <div className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {seasons.map((s) => (
            <a key={s.season} href={`/standings?season=${s.season}`} className="btn"
               style={{ padding: '6px 12px' }}>
              {s.season}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
