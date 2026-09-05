import { notFound } from 'next/navigation';

import { getCachedSeasonList } from '../../../lib/cached-queries.ts';
import { getCachedHistorySeason } from '../../../lib/history-cache.ts';
import { finish, franchiseHref, managerHref, pointsPerGame, record, seasonHref, winRate } from '../../../lib/history-format.ts';

export const revalidate = 86400;

function gameSummary(row: { team_name: string; opponent_name: string; points_for: string; points_against: string }) {
  return `${row.team_name} ${row.points_for}–${row.points_against} ${row.opponent_name}`;
}

export default async function SeasonHistoryPage({ params }: { params: Promise<{ season: string }> }) {
  const raw = await params;
  const season = Number(raw.season);
  if (!Number.isInteger(season) || season < 2005) notFound();

  const [[rows, managers, playoffGames, highlights], seasonList] = await Promise.all([
    getCachedHistorySeason(season),
    getCachedSeasonList(),
  ]);
  if (rows.length === 0) notFound();

  const managerByFranchise = new Map(managers.map((manager) => [manager.franchise_key, manager]));
  const champion = rows.find((row) => row.is_champion) ?? null;
  const runnerUp = rows.find((row) => row.is_runner_up) ?? null;
  const bestRecord = [...rows].sort((a, b) => {
    const diff = winRate(b.wins, b.losses, b.ties) - winRate(a.wins, a.losses, a.ties);
    return diff || Number(b.points_for ?? 0) - Number(a.points_for ?? 0);
  })[0]!;
  const topOffense = [...rows].sort((a, b) =>
    (pointsPerGame(b.points_for, b.wins, b.losses, b.ties) ?? 0)
    - (pointsPerGame(a.points_for, a.wins, a.losses, a.ties) ?? 0)
  )[0]!;
  const currentIndex = seasonList.findIndex((row) => row.season === season);
  const newer = currentIndex > 0 ? seasonList[currentIndex - 1]?.season : null;
  const older = currentIndex >= 0 && currentIndex < seasonList.length - 1 ? seasonList[currentIndex + 1]?.season : null;
  const maxPlayoffWeek = playoffGames.length ? Math.max(...playoffGames.map((game) => game.week)) : null;
  const source = rows[0]!.source;

  const roundLabel = (week: number) => {
    if (maxPlayoffWeek === null) return 'Playoffs';
    if (week === maxPlayoffWeek) return 'Championship';
    if (week === maxPlayoffWeek - 1) return 'Semifinal';
    return 'First round';
  };

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">Season file · {source === 'manual' ? 'commissioner archive' : 'ESPN record'}</div>
        <h1>{season} Grudge Match</h1>
        <p>
          {champion ? <><strong>{champion.team_name}</strong> won the championship.</> : 'Final season record.'}
        </p>
      </div>

      <div className="stat-strip three">
        <div>
          <span>Champion</span>
          <strong>{champion?.team_name ?? '—'}</strong>
        </div>
        <div>
          <span>Best regular season</span>
          <strong>{record(bestRecord.wins, bestRecord.losses, bestRecord.ties)}</strong>
          <small className="block note">{bestRecord.team_name}</small>
        </div>
        <div>
          <span>Best offense</span>
          <strong>{pointsPerGame(topOffense.points_for, topOffense.wins, topOffense.losses, topOffense.ties)?.toFixed(1) ?? '—'} PF/G</strong>
          <small className="block note">{topOffense.team_name}</small>
        </div>
      </div>

      {champion && (
        <>
          <h2>Championship</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              <a className="tname" href={franchiseHref(champion.franchise_key)}>{champion.team_name}</a>{' '}
              finished {record(champion.wins, champion.losses, champion.ties)} and beat{' '}
              {runnerUp ? <a href={franchiseHref(runnerUp.franchise_key)}>{runnerUp.team_name}</a> : 'the runner-up'}.
            </p>
            {managerByFranchise.get(champion.franchise_key) && (
              <p className="note" style={{ marginBottom: 0 }}>
                Managed by{' '}
                <a href={managerHref(managerByFranchise.get(champion.franchise_key)!.manager_key)}>
                  {managerByFranchise.get(champion.franchise_key)!.display_name}
                </a>.
              </p>
            )}
          </div>
        </>
      )}

      {(highlights.highestScore || highlights.topPlayer || highlights.biggestBlowout || highlights.closestFinish) && (
        <>
          <h2>Season highlights</h2>
          <p className="sub">Week-level records are available from the ESPN era onward.</p>
          <div className="card">
            <div style={{ display: 'grid', gap: 14 }}>
              {highlights.highestScore && (
                <div>
                  <strong>Highest team score</strong>
                  <span className="block">{gameSummary(highlights.highestScore)} · Week {highlights.highestScore.week}</span>
                </div>
              )}
              {highlights.topPlayer && (
                <div>
                  <strong>Best individual week</strong>
                  <span className="block">
                    {highlights.topPlayer.full_name ?? 'Unknown player'} — {highlights.topPlayer.points} for{' '}
                    <a href={franchiseHref(highlights.topPlayer.franchise_key)}>{highlights.topPlayer.team_name}</a>, week {highlights.topPlayer.week}
                    {!highlights.topPlayer.is_starter && ' (benched)'}
                  </span>
                </div>
              )}
              {highlights.biggestBlowout && (
                <div>
                  <strong>Biggest blowout</strong>
                  <span className="block">{gameSummary(highlights.biggestBlowout)} · {Number(highlights.biggestBlowout.margin).toFixed(1)} points</span>
                </div>
              )}
              {highlights.closestFinish && (
                <div>
                  <strong>Closest finish</strong>
                  <span className="block">{gameSummary(highlights.closestFinish)} · {Math.abs(Number(highlights.closestFinish.margin)).toFixed(1)} points</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {playoffGames.length > 0 && (
        <>
          <h2>Championship bracket</h2>
          <div className="card">
            <div className="scroll">
              <table>
                <thead><tr><th>Round</th><th>Winner</th><th>Loser</th><th className="num">Score</th></tr></thead>
                <tbody>
                  {playoffGames.map((game) => {
                    const homeWon = game.winner === 'HOME';
                    const winner = homeWon
                      ? { key: game.home_key, name: game.home_name, points: game.home_points }
                      : { key: game.away_key, name: game.away_name, points: game.away_points };
                    const loser = homeWon
                      ? { key: game.away_key, name: game.away_name, points: game.away_points }
                      : { key: game.home_key, name: game.home_name, points: game.home_points };
                    return (
                      <tr key={`${game.week}-${game.espn_matchup_id}`}>
                        <td>{roundLabel(game.week)}<span className="tsub block">Week {game.week}</span></td>
                        <td><a className="tname" href={franchiseHref(winner.key)}>{winner.name}</a></td>
                        <td><a href={franchiseHref(loser.key)}>{loser.name}</a></td>
                        <td className="num"><strong>{winner.points}</strong>–{loser.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <h2>Final standings</h2>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th className="rank">#</th><th>Franchise</th><th>Manager</th>
                <th className="num">Record</th><th className="num">PF</th>
                <th className="num">PF/G</th><th className="num">Finish</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const manager = managerByFranchise.get(row.franchise_key);
                return (
                  <tr key={row.franchise_key} className={row.is_champion ? 'title-row' : undefined}>
                    <td className="rank">{row.final_place ?? '—'}</td>
                    <td>
                      <a className="tname" href={franchiseHref(row.franchise_key)}>{row.team_name}</a>
                      {row.team_name !== row.current_name && <span className="tsub block">now {row.current_name}</span>}
                    </td>
                    <td>{manager ? <a href={managerHref(manager.manager_key)}>{manager.display_name}</a> : '—'}</td>
                    <td className="num">{record(row.wins, row.losses, row.ties)}</td>
                    <td className="num">{row.points_for ?? '—'}</td>
                    <td className="num">{pointsPerGame(row.points_for, row.wins, row.losses, row.ties)?.toFixed(1) ?? '—'}</td>
                    <td className="num">{finish(row.final_place) ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {source === 'manual' && (
          <p className="note">The 2005–2017 commissioner archive contains season totals and playoff finish order, but not weekly scores or individual player performances.</p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 24 }}>
        {older && <a className="btn btn-quiet" href={seasonHref(older)}>← {older}</a>}
        <a className="btn btn-quiet" href={`/standings?season=${season}`}>Standings view</a>
        <a className="btn btn-quiet" href="/history">League history</a>
        {newer && <a className="btn btn-quiet" href={seasonHref(newer)}>{newer} →</a>}
      </div>
    </>
  );
}
