import { getTeams, getRivalries, getAllTime, CURRENT_SEASON } from '../../../lib/queries.ts';
import { asPublic } from '../../../lib/db.ts';

export const revalidate = 3600;

export default async function Team({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  const teams = await getTeams(CURRENT_SEASON);
  const team = teams.find((t) => t.espn_team_id === teamId);
  if (!team) return <p className="empty">No such team.</p>;

  const [rivals, allTime, bySeason] = await Promise.all([
    getRivalries(teamId),
    getAllTime(),
    asPublic<{ season: number; wins: number; losses: number; ties: number; points_for: string }>(
      `with finals as (
         select season, max(week) w from public.team_week_results
          where espn_team_id = $1 group by season
       )
       select r.season, r.cum_wins as wins, r.cum_losses as losses, r.cum_ties as ties,
              round(r.cum_points_for,1)::text as points_for
         from finals f
         join public.team_week_results r
           on r.season = f.season and r.week = f.w and r.espn_team_id = $1
        order by r.season desc`,
      [teamId]
    ),
  ]);
  const overall = allTime.find((a) => a.espn_team_id === teamId);

  return (
    <>
      <h1>{team.name}</h1>
      <p className="sub">{team.owners ?? 'Unknown owner'}</p>

      {overall && (
        <div className="card">
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            <div>
              <div className="tsub">All-time</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {overall.wins}-{overall.losses}{overall.ties ? `-${overall.ties}` : ''}
              </div>
            </div>
            <div>
              <div className="tsub">Seasons</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{overall.seasons}</div>
            </div>
            <div>
              <div className="tsub">Total points</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {Number(overall.points_for).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      <h2>Season by season</h2>
      <div className="card">
        <table>
          <thead><tr><th>Season</th><th className="num">Record</th><th className="num">Points</th></tr></thead>
          <tbody>
            {bySeason.map((s) => (
              <tr key={s.season}>
                <td><a href={`/standings?season=${s.season}`}>{s.season}</a></td>
                <td className="num">{s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ''}</td>
                <td className="num">{s.points_for}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Rivalries</h2>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Opponent</th><th className="num">Record</th><th className="num">Games</th><th className="num">Since</th></tr>
            </thead>
            <tbody>
              {rivals.map((r) => (
                <tr key={r.opp_id}>
                  <td><a href={`/team/${r.opp_id}`} className="tname">{r.name}</a></td>
                  <td className="num">
                    <span className={`pill ${r.wins > r.losses ? 'w' : r.wins < r.losses ? 'l' : ''}`}>
                      {r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}
                    </span>
                  </td>
                  <td className="num">{r.games}</td>
                  <td className="num">{r.first_season}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
