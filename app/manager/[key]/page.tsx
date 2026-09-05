import { notFound } from 'next/navigation';

import { getCachedManagerFile } from '../../../lib/history-cache.ts';
import { finish, franchiseHref, pointsPerGame, record, seasonHref, winRate } from '../../../lib/history-format.ts';

export const revalidate = 86400;

export default async function ManagerPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [profile, seasons] = await getCachedManagerFile(key);
  if (!profile || seasons.length === 0) notFound();

  const bestSeason = [...seasons].sort((a, b) => {
    const rateDiff = winRate(b.wins, b.losses, b.ties) - winRate(a.wins, a.losses, a.ties);
    if (rateDiff !== 0) return rateDiff;
    return (pointsPerGame(b.points_for, b.wins, b.losses, b.ties) ?? 0)
      - (pointsPerGame(a.points_for, a.wins, a.losses, a.ties) ?? 0);
  })[0]!;
  const franchiseKeys = [...new Set(seasons.map((season) => season.franchise_key))];

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Manager file · {profile.first_season}–{profile.last_season}</div>
        <h1>{profile.display_name}</h1>
        <p>{profile.seasons} seasons across {franchiseKeys.length} franchise{franchiseKeys.length === 1 ? '' : 's'}.</p>
      </div>

      <div className="stat-strip three">
        <div><span>Regular season</span><strong>{record(profile.regular_wins, profile.regular_losses, profile.regular_ties)}</strong></div>
        <div><span>Playoffs</span><strong>{profile.playoff_wins}-{profile.playoff_losses}</strong></div>
        <div><span>Titles</span><strong>{profile.championships}</strong></div>
      </div>

      <h2>Career snapshot</h2>
      <div className="card">
        <div className="stat-strip three" style={{ margin: 0 }}>
          <div>
            <span>Win percentage</span>
            <strong>{(winRate(profile.regular_wins, profile.regular_losses, profile.regular_ties) * 100).toFixed(1)}%</strong>
          </div>
          <div><span>Playoff berths</span><strong>{profile.playoff_appearances}</strong></div>
          <div><span>Top-four finishes</span><strong>{profile.top_four}</strong></div>
        </div>
        <p className="note" style={{ marginBottom: 0 }}>
          Best regular season: <a href={seasonHref(bestSeason.season)}>{bestSeason.season}</a> with{' '}
          <strong>{record(bestSeason.wins, bestSeason.losses, bestSeason.ties)}</strong>
          {bestSeason.is_champion ? ' and a championship.' : '.'}
        </p>
      </div>

      <h2>Season by season</h2>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Season</th><th>Franchise</th><th>Team name</th>
                <th className="num">Record</th><th className="num">PF/G</th>
                <th className="num">Playoffs</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((season) => (
                <tr key={`${season.season}-${season.franchise_key}`} className={season.is_champion ? 'title-row' : undefined}>
                  <td><a className="tname" href={seasonHref(season.season)}>{season.season}</a></td>
                  <td><a href={franchiseHref(season.franchise_key)}>{season.current_name}</a></td>
                  <td>
                    {season.team_name}
                    {season.is_champion && <span className="tag best">Champion</span>}
                    {season.is_runner_up && <span className="tag era">Runner-up</span>}
                  </td>
                  <td className="num">{record(season.wins, season.losses, season.ties)}</td>
                  <td className="num">
                    {pointsPerGame(season.points_for, season.wins, season.losses, season.ties)?.toFixed(1) ?? '—'}
                  </td>
                  <td className="num">
                    {season.final_place !== null && season.final_place <= 6
                      ? <>{season.playoff_wins}-{season.playoff_losses}<span className="tsub block">{finish(season.final_place)}</span></>
                      : <span className="tsub">missed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {franchiseKeys.length > 1 && (
        <>
          <h2>Franchises managed</h2>
          <div className="card">
            {franchiseKeys.map((franchiseKey) => {
              const sample = seasons.find((season) => season.franchise_key === franchiseKey)!;
              const years = seasons.filter((season) => season.franchise_key === franchiseKey).map((season) => season.season);
              return (
                <p key={franchiseKey} style={{ margin: '8px 0' }}>
                  <a className="tname" href={franchiseHref(franchiseKey)}>{sample.current_name}</a>{' '}
                  <span className="tsub">{Math.min(...years)}–{Math.max(...years)}</span>
                </p>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
