import { HistoryNav } from '../../../components/HistoryNav.tsx';
import {
  rivalryHighlights,
  seriesLeader,
  type RivalryPairRow,
} from '../../../lib/rivalry-leaderboard.ts';
import {
  getAllTimeRivalryPairs,
  getHighestScoringRivalryGame,
} from '../../../lib/rivalry-queries.ts';

export const dynamic = 'force-dynamic';

const grudgeHref = (a: string, b: string) =>
  `/grudge/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
const hrefFor = (row: RivalryPairRow) => grudgeHref(row.manager_a_key, row.manager_b_key);

function record(row: RivalryPairRow) {
  return `${row.manager_a_wins}-${row.manager_b_wins}${row.ties ? `-${row.ties}` : ''}`;
}

function playoffRecord(row: RivalryPairRow) {
  const ties = row.playoff_games - row.manager_a_playoff_wins - row.manager_b_playoff_wins;
  return `${row.manager_a_playoff_wins}-${row.manager_b_playoff_wins}${ties ? `-${ties}` : ''}`;
}

function pairName(row: RivalryPairRow) {
  return <a className="tname" href={hrefFor(row)}>{row.manager_a_name} vs. {row.manager_b_name}</a>;
}

export default async function AllTimeRivalriesPage() {
  const [pairs, highestGame] = await Promise.all([
    getAllTimeRivalryPairs(),
    getHighestScoringRivalryGame(),
  ]);
  const highlights = rivalryHighlights(pairs);
  const dominationLeader = highlights.domination ? seriesLeader(highlights.domination) : null;
  const playoffNemesis = highlights.playoffNemesis ? seriesLeader(highlights.playoffNemesis, true) : null;

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The permanent grudges</div>
        <h1>Manager grudges</h1>
        <p>The record follows the people. Franchise changes do not reset who owns whom.</p>
      </div>

      <HistoryNav current="rivalries" />

      <h2>Grudge superlatives</h2>
      <p className="sub">Lifetime closeness and domination require at least 20 meetings so a short tenure cannot steal a historical headline.</p>
      <div className="card">
        <div style={{ display: 'grid', gap: 20 }}>
          {highlights.mostPlayed && (
            <div>
              <span className="eyebrow">Most played</span>
              <strong className="block">{pairName(highlights.mostPlayed)}</strong>
              <span className="block note">{highlights.mostPlayed.games} games · {record(highlights.mostPlayed)} from {highlights.mostPlayed.manager_a_name}&rsquo;s side · since {highlights.mostPlayed.first_season}</span>
            </div>
          )}
          {highlights.closest && (
            <div>
              <span className="eyebrow">Closest lifetime grudge</span>
              <strong className="block">{pairName(highlights.closest)}</strong>
              <span className="block note">{record(highlights.closest)} across {highlights.closest.games} games</span>
            </div>
          )}
          {highlights.domination && dominationLeader && (
            <div>
              <span className="eyebrow">Biggest lifetime edge</span>
              <strong className="block">
                {dominationLeader.name} over {dominationLeader.id === highlights.domination.manager_a_key ? highlights.domination.manager_b_name : highlights.domination.manager_a_name}
              </strong>
              <span className="block note"><a href={hrefFor(highlights.domination)}>{dominationLeader.wins}-{dominationLeader.losses} in {highlights.domination.games} meetings →</a></span>
            </div>
          )}
          {highlights.playoffNemesis && playoffNemesis && (
            <div>
              <span className="eyebrow">Playoff nemesis</span>
              <strong className="block">{playoffNemesis.name}</strong>
              <span className="block note"><a href={hrefFor(highlights.playoffNemesis)}>{playoffNemesis.wins}-{playoffNemesis.losses} in the playoffs against {playoffNemesis.id === highlights.playoffNemesis.manager_a_key ? highlights.playoffNemesis.manager_b_name : highlights.playoffNemesis.manager_a_name} · {highlights.playoffNemesis.playoff_games} playoff meetings →</a></span>
            </div>
          )}
          {highestGame && (
            <div>
              <span className="eyebrow">Highest-scoring grudge game</span>
              <strong className="block">{highestGame.away_manager_name} {highestGame.away_points}–{highestGame.home_points} {highestGame.home_manager_name}</strong>
              <span className="block note">
                <a href={grudgeHref(highestGame.away_manager_key, highestGame.home_manager_key)}>
                  {highestGame.total_points} combined points · {highestGame.season} week {highestGame.week}{highestGame.playoff_tier ? ' · playoffs' : ''} · {highestGame.away_team_name} at {highestGame.home_team_name} →
                </a>
              </span>
            </div>
          )}
        </div>
      </div>

      <h2>Every grudge</h2>
      <p className="sub">All manager pairings, ordered by games played. A manager carries the same record across every franchise they controlled.</p>
      <div className="card">
        <div className="scroll"><table>
          <thead><tr><th>Managers</th><th className="num">Games</th><th className="num">Lifetime</th><th className="num">Playoffs</th><th className="num">Playoff record</th><th className="num">Since</th></tr></thead>
          <tbody>{pairs.map((row) => (
            <tr key={`${row.manager_a_key}-${row.manager_b_key}`}>
              <td>{pairName(row)}</td><td className="num">{row.games}</td><td className="num">{record(row)}</td>
              <td className="num">{row.playoff_games || '—'}</td><td className="num">{row.playoff_games ? playoffRecord(row) : '—'}</td><td className="num">{row.first_season}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>

      <div className="callout" style={{ marginTop: 24 }}>
        A game belongs to the primary managers recorded for those franchises in that season. Regular-season games count; after the regular-season boundary, only championship-bracket games count. Consolation games never enter a grudge.
      </div>
    </>
  );
}
