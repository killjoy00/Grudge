import { notFound } from 'next/navigation';

import { HistoryNav } from '../../../../components/HistoryNav.tsx';
import { managerHref } from '../../../../lib/history-format.ts';
import { getManagerGrudgeSeries, type ManagerGrudgeGame } from '../../../../lib/rivalry-queries.ts';

export const dynamic = 'force-dynamic';

function viewFrom(game: ManagerGrudgeGame, managerKey: string) {
  const home = game.home_manager_key === managerKey;
  const pointsFor = Number(home ? game.home_points ?? 0 : game.away_points ?? 0);
  const pointsAgainst = Number(home ? game.away_points ?? 0 : game.home_points ?? 0);
  const opponentKey = home ? game.away_manager_key : game.home_manager_key;
  const opponent = home ? game.away_manager_name : game.home_manager_name;
  const team = home ? game.home_team_name : game.away_team_name;
  const opponentTeam = home ? game.away_team_name : game.home_team_name;
  const result = pointsFor > pointsAgainst ? 'W' : pointsFor < pointsAgainst ? 'L' : 'T';
  return { pointsFor, pointsAgainst, opponentKey, opponent, team, opponentTeam, result, margin: pointsFor - pointsAgainst };
}

function record(wins: number, losses: number, ties: number) {
  return `${wins}-${losses}${ties ? `-${ties}` : ''}`;
}

function roundLabel(game: ManagerGrudgeGame) {
  if (game.playoff_rounds_from_final === null) return 'Regular season';
  if (game.playoff_rounds_from_final === 1) return 'Championship';
  if (game.playoff_rounds_from_final === 2) return 'Semifinal';
  if (game.playoff_rounds_from_final === 3) return 'First round';
  return 'Playoffs';
}

function highestLeverage(games: ManagerGrudgeGame[]) {
  const playoffs = games.filter((game) => game.playoff_rounds_from_final !== null);
  if (playoffs.length > 0) {
    const bestRound = Math.min(...playoffs.map((game) => game.playoff_rounds_from_final!));
    return playoffs.filter((game) => game.playoff_rounds_from_final === bestRound);
  }
  const regular = games.filter((game) => game.playoff_rounds_from_final === null);
  if (regular.length === 0) return [];
  const latestWeek = Math.max(...regular.map((game) => game.week));
  return regular.filter((game) => game.week === latestWeek);
}

export default async function GrudgePage({ params }: { params: Promise<{ managerA: string; managerB: string }> }) {
  const raw = await params;
  const managerA = decodeURIComponent(raw.managerA);
  const managerB = decodeURIComponent(raw.managerB);
  if (!managerA || !managerB || managerA === managerB) notFound();

  const { managers, games } = await getManagerGrudgeSeries(managerA, managerB);
  const a = managers.find((manager) => manager.manager_key === managerA);
  const b = managers.find((manager) => manager.manager_key === managerB);
  if (!a || !b) notFound();

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  for (const game of games) {
    const view = viewFrom(game, managerA);
    pointsFor += view.pointsFor;
    pointsAgainst += view.pointsAgainst;
    if (view.result === 'W') wins += 1;
    else if (view.result === 'L') losses += 1;
    else ties += 1;
  }

  const closest = games.reduce<ManagerGrudgeGame | null>((best, game) => {
    if (!best) return game;
    return Math.abs(viewFrom(game, managerA).margin) < Math.abs(viewFrom(best, managerA).margin) ? game : best;
  }, null);
  const biggestWin = games.reduce<ManagerGrudgeGame | null>((best, game) => {
    const margin = viewFrom(game, managerA).margin;
    if (margin <= 0) return best;
    return !best || margin > viewFrom(best, managerA).margin ? game : best;
  }, null);
  const latest = games[0] ?? null;
  const firstSeason = games.length ? games[games.length - 1]!.season : null;
  const playoffGames = games.filter((game) => game.playoff_rounds_from_final !== null).length;
  const leverageGames = highestLeverage(games);

  const moment = (label: string, game: ManagerGrudgeGame | null) => {
    if (!game) return null;
    const view = viewFrom(game, managerA);
    return (
      <div>
        <span>{label}</span>
        <strong>{view.result} {view.pointsFor.toFixed(1)}-{view.pointsAgainst.toFixed(1)}</strong>
        <small className="block note">{game.season} week {game.week} · {roundLabel(game)} · {view.team} vs. {view.opponentTeam}</small>
      </div>
    );
  };

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">Manager grudge · tracked ledger</div>
        <h1>{a.display_name} vs. {b.display_name}</h1>
        <p>Every tracked meeting between these managers since {firstSeason ?? 2005}, regardless of which franchise they were running.</p>
      </div>

      <HistoryNav current="rivalries" />

      <div className="stat-strip three">
        <div><span>{a.display_name} record</span><strong>{record(wins, losses, ties)}</strong></div>
        <div><span>Points differential</span><strong>{pointsFor - pointsAgainst > 0 ? '+' : ''}{(pointsFor - pointsAgainst).toFixed(1)}</strong></div>
        <div><span>Playoff meetings</span><strong>{playoffGames}</strong></div>
      </div>

      {games.length > 0 ? (
        <>
          <div className="stat-strip three">
            {moment('Latest meeting', latest)}
            {moment('Closest finish', closest)}
            {moment(`${a.display_name}'s biggest win`, biggestWin)}
          </div>

          {leverageGames.length > 0 && (
            <>
              <h2>Highest leverage</h2>
              <p className="sub">Championship outranks semifinal, which outranks first round. If these managers never met in the playoffs, the latest regular-season week is the highest-leverage stage. Ties at the best stage all stay on the board.</p>
              <div className="card">
                {leverageGames.map((game, index) => {
                  const view = viewFrom(game, managerA);
                  return (
                    <div key={`leverage-${game.season}-${game.espn_matchup_id}`} style={{ padding: '10px 0', borderBottom: index === leverageGames.length - 1 ? undefined : '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <div>
                          <span className="eyebrow">{roundLabel(game)}</span>
                          <strong className="block">{game.season} week {game.week}</strong>
                          <span className="note">{view.team} vs. {view.opponentTeam}</span>
                        </div>
                        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{view.result} {view.pointsFor.toFixed(1)}-{view.pointsAgainst.toFixed(1)}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <h2>The ledger</h2>
          <div className="card"><div className="scroll"><table>
            <thead><tr><th>Week</th><th>Teams</th><th className="num">Result</th><th className="num">Score</th><th className="num">Margin</th><th>Round</th></tr></thead>
            <tbody>{games.map((game) => {
              const view = viewFrom(game, managerA);
              return (
                <tr key={`${game.season}-${game.espn_matchup_id}`}>
                  <td><a href={`/history/vault/${game.season}`} className="tname">{game.season} wk {game.week}</a></td>
                  <td>{view.team}<span className="tsub block">vs. {view.opponentTeam}</span></td>
                  <td className="num"><span className={`pill ${view.result === 'W' ? 'w' : view.result === 'L' ? 'l' : ''}`}>{view.result}</span></td>
                  <td className="num">{view.pointsFor.toFixed(1)}-{view.pointsAgainst.toFixed(1)}</td>
                  <td className="num">{view.margin > 0 ? '+' : ''}{view.margin.toFixed(1)}</td>
                  <td>{game.playoff_rounds_from_final !== null ? <span className="tag era">{roundLabel(game)}</span> : 'Regular'}</td>
                </tr>
              );
            })}</tbody>
          </table></div></div>
        </>
      ) : <div className="callout">These managers have not met in the tracked league record yet.</div>}

      <div className="card">
        <p className="note" style={{ margin: 0 }}>Manager identity follows the primary manager recorded for each franchise in each season. Regular-season games count; after the regular-season boundary, only the championship bracket counts. Consolation placement games remain source evidence only.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <a className="btn btn-quiet" href={managerHref(managerA)}>{a.display_name} manager file</a>
          <a className="btn btn-quiet" href={managerHref(managerB)}>{b.display_name} manager file</a>
          <a className="btn btn-quiet" href="/history/rivalries">All grudges</a>
        </div>
      </div>
    </>
  );
}
