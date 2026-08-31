import { getTeams, getRivalries, getAllTime, getCurrentSeason } from '../../../lib/queries.ts';
import { asPublic } from '../../../lib/db.ts';

export const revalidate = 3600;

export default async function Team({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  const season = await getCurrentSeason();
  const teams = await getTeams(season);
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
      <div className="page-hero compact-hero">
        <div className="eyebrow">Franchise file</div>
        <h1>{team.name}</h1>
        <p>{team.owners ?? 'Unknown owner'}</p>
      </div>

      {overall && (
        <div className="stat-strip three">
            <div>
              <span>All-time</span>
              <strong>
                {overall.wins}-{overall.losses}{overall.ties ? `-${overall.ties}` : ''}
              </strong>
            </div>
            <div>
              <span>Seasons</span>
              <strong>{overall.seasons}</strong>
            </div>
            <div>
              <span>Total points</span>
              <strong>
                {Number(overall.points_for).toLocaleString()}
              </strong>
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
