import { notFound } from 'next/navigation';

import { HistoryNav } from '../../../../components/HistoryNav.tsx';
import { getRivalrySeries, type RivalryGame } from '../../../../lib/game-context.ts';

export const dynamic = 'force-dynamic';

function viewFrom(game: RivalryGame, teamId: number) {
  const home = game.home_team_id === teamId;
  const pointsFor = Number(home ? game.home_points ?? 0 : game.away_points ?? 0);
  const pointsAgainst = Number(home ? game.away_points ?? 0 : game.home_points ?? 0);
  const opponentId = home ? game.away_team_id : game.home_team_id;
  const opponent = home ? game.away_name : game.home_name;
  const result = pointsFor > pointsAgainst ? 'W' : pointsFor < pointsAgainst ? 'L' : 'T';
  return { pointsFor, pointsAgainst, opponentId, opponent, result, margin: pointsFor - pointsAgainst };
}

function record(wins: number, losses: number, ties: number) {
  return `${wins}-${losses}${ties ? `-${ties}` : ''}`;
}

function roundLabel(tier: string | null) {
  if (!tier) return 'Regular season';
  return tier === 'WINNERS_BRACKET' ? 'Playoffs' : 'Consolation';
}

export default async function RivalryPage({ params }: { params: Promise<{ teamA: string; teamB: string }> }) {
  const raw = await params;
  const teamA = Number(raw.teamA);
  const teamB = Number(raw.teamB);
  if (!Number.isInteger(teamA) || !Number.isInteger(teamB) || teamA < 1 || teamB < 1 || teamA === teamB) notFound();

  const { teams, games } = await getRivalrySeries(teamA, teamB);
  const a = teams.find((team) => team.espn_team_id === teamA);
  const b = teams.find((team) => team.espn_team_id === teamB);
  if (!a || !b) notFound();

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  for (const game of games) {
    const view = viewFrom(game, teamA);
    pointsFor += view.pointsFor;
    pointsAgainst += view.pointsAgainst;
    if (view.result === 'W') wins += 1;
    else if (view.result === 'L') losses += 1;
    else ties += 1;
  }

  const closest = games.reduce<RivalryGame | null>((best, game) => {
    if (!best) return game;
    return Math.abs(viewFrom(game, teamA).margin) < Math.abs(viewFrom(best, teamA).margin) ? game : best;
  }, null);
  const biggestWin = games.reduce<RivalryGame | null>((best, game) => {
    const margin = viewFrom(game, teamA).margin;
    if (margin <= 0) return best;
    return !best || margin > viewFrom(best, teamA).margin ? game : best;
  }, null);
  const latest = games[0] ?? null;
  const firstSeason = games.length ? games[games.length - 1]!.season : null;
  const playoffGames = games.filter((game) => game.playoff_tier).length;

  const moment = (label: string, game: RivalryGame | null) => {
    if (!game) return null;
    const view = viewFrom(game, teamA);
    return (
      <div>
        <span>{label}</span>
        <strong>{view.result} {view.pointsFor.toFixed(1)}-{view.pointsAgainst.toFixed(1)}</strong>
        <small className="block note">{game.season} week {game.week} · {roundLabel(game.playoff_tier)}</small>
      </div>
    );
  };

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">Rivalry file · complete recovered ledger</div>
        <h1>{a.name} vs. {b.name}</h1>
        <p>Every meeting on file since {firstSeason ?? 2005}, including the playoffs.</p>
      </div>

      <HistoryNav current="rivalries" />

      <div className="stat-strip three">
        <div><span>{a.name} record</span><strong>{record(wins, losses, ties)}</strong></div>
        <div><span>Points differential</span><strong>{pointsFor - pointsAgainst > 0 ? '+' : ''}{(pointsFor - pointsAgainst).toFixed(1)}</strong></div>
        <div><span>Playoff meetings</span><strong>{playoffGames}</strong></div>
      </div>

      {games.length > 0 ? (
        <>
          <div className="stat-strip three">
            {moment('Latest meeting', latest)}
            {moment('Closest finish', closest)}
            {moment(`${a.name}'s biggest win`, biggestWin)}
          </div>

          <h2>The ledger</h2>
          <div className="card"><div className="scroll"><table>
            <thead><tr><th>Week</th><th>Opponent</th><th className="num">Result</th><th className="num">Score</th><th className="num">Margin</th><th>Round</th></tr></thead>
            <tbody>{games.map((game) => {
              const view = viewFrom(game, teamA);
              return (
                <tr key={`${game.season}-${game.espn_matchup_id}`}>
                  <td><a href={`/history/vault/${game.season}`} className="tname">{game.season} wk {game.week}</a></td>
                  <td><a href={`/team/${view.opponentId}`}>{view.opponent}</a></td>
                  <td className="num"><span className={`pill ${view.result === 'W' ? 'w' : view.result === 'L' ? 'l' : ''}`}>{view.result}</span></td>
                  <td className="num">{view.pointsFor.toFixed(1)}-{view.pointsAgainst.toFixed(1)}</td>
                  <td className="num">{view.margin > 0 ? '+' : ''}{view.margin.toFixed(1)}</td>
                  <td>{game.playoff_tier ? <span className="tag era">{roundLabel(game.playoff_tier)}</span> : 'Regular'}</td>
                </tr>
              );
            })}</tbody>
          </table></div></div>
        </>
      ) : <div className="callout">These franchises have not met in the recovered league record yet.</div>}

      <div className="card">
        <p className="note" style={{ margin: 0 }}>
          Week-by-week ESPN scoreboards are recovered through 2005. Historical team names remain attached to each game while the lifetime series follows permanent franchise identity.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <a className="btn btn-quiet" href={`/team/${teamA}`}>{a.name} franchise file</a>
          <a className="btn btn-quiet" href={`/team/${teamB}`}>{b.name} franchise file</a>
          <a className="btn btn-quiet" href="/history/rivalries">All rivalries</a>
        </div>
      </div>
    </>
  );
}
