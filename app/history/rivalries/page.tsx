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

const hrefFor = (row: RivalryPairRow) => `/rivalry/${row.team_a_id}/${row.team_b_id}`;

function record(row: RivalryPairRow) {
  return `${row.team_a_wins}-${row.team_b_wins}${row.ties ? `-${row.ties}` : ''}`;
}

function playoffRecord(row: RivalryPairRow) {
  const ties = row.playoff_games - row.team_a_playoff_wins - row.team_b_playoff_wins;
  return `${row.team_a_playoff_wins}-${row.team_b_playoff_wins}${ties ? `-${ties}` : ''}`;
}

function pairName(row: RivalryPairRow) {
  return <a className="tname" href={hrefFor(row)}>{row.team_a_name} vs. {row.team_b_name}</a>;
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
        <h1>All-time rivalries</h1>
        <p>Every recovered meeting since 2005, rolled up by permanent franchise. Old names change; the receipts do not.</p>
      </div>

      <HistoryNav current="rivalries" />

      <h2>Grudge superlatives</h2>
      <p className="sub">Lifetime closeness and domination require at least 20 meetings so a short series cannot steal a historical headline.</p>
      <div className="card">
        <div style={{ display: 'grid', gap: 20 }}>
          {highlights.mostPlayed && (
            <div>
              <span className="eyebrow">Most played</span>
              <strong className="block">{pairName(highlights.mostPlayed)}</strong>
              <span className="block note">{highlights.mostPlayed.games} games · {record(highlights.mostPlayed)} from {highlights.mostPlayed.team_a_name}&rsquo;s side · since {highlights.mostPlayed.first_season}</span>
            </div>
          )}
          {highlights.closest && (
            <div>
              <span className="eyebrow">Closest lifetime series</span>
              <strong className="block">{pairName(highlights.closest)}</strong>
              <span className="block note">{record(highlights.closest)} across {highlights.closest.games} games</span>
            </div>
          )}
          {highlights.domination && dominationLeader && (
            <div>
              <span className="eyebrow">Biggest lifetime edge</span>
              <strong className="block">{dominationLeader.name} over {dominationLeader.id === highlights.domination.team_a_id ? highlights.domination.team_b_name : highlights.domination.team_a_name}</strong>
              <span className="block note"><a href={hrefFor(highlights.domination)}>{dominationLeader.wins}-{dominationLeader.losses} in {highlights.domination.games} meetings →</a></span>
            </div>
          )}
          {highlights.playoffNemesis && playoffNemesis && (
            <div>
              <span className="eyebrow">Playoff nemesis</span>
              <strong className="block">{playoffNemesis.name}</strong>
              <span className="block note"><a href={hrefFor(highlights.playoffNemesis)}>{playoffNemesis.wins}-{playoffNemesis.losses} in the playoffs against {playoffNemesis.id === highlights.playoffNemesis.team_a_id ? highlights.playoffNemesis.team_b_name : highlights.playoffNemesis.team_a_name} · {highlights.playoffNemesis.playoff_games} playoff meetings →</a></span>
            </div>
          )}
          {highestGame && (
            <div>
              <span className="eyebrow">Highest-scoring rivalry game</span>
              <strong className="block">{highestGame.home_name} {highestGame.home_points}–{highestGame.away_points} {highestGame.away_name}</strong>
              <span className="block note"><a href={`/rivalry/${highestGame.home_team_id}/${highestGame.away_team_id}`}>{highestGame.total_points} combined points · {highestGame.season} week {highestGame.week}{highestGame.playoff_tier ? ' · playoffs' : ''} →</a></span>
            </div>
          )}
        </div>
      </div>

      <h2>Every rivalry</h2>
      <p className="sub">All franchise pairings, ordered by games played. Playoff records use the same team order as the lifetime record.</p>
      <div className="card">
        <div className="scroll"><table>
          <thead><tr><th>Rivalry</th><th className="num">Games</th><th className="num">Lifetime</th><th className="num">Playoffs</th><th className="num">Playoff record</th><th className="num">Since</th></tr></thead>
          <tbody>{pairs.map((row) => (
            <tr key={`${row.team_a_id}-${row.team_b_id}`}>
              <td>{pairName(row)}</td><td className="num">{row.games}</td><td className="num">{record(row)}</td>
              <td className="num">{row.playoff_games || '—'}</td><td className="num">{row.playoff_games ? playoffRecord(row) : '—'}</td><td className="num">{row.first_season}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>

      <div className="callout" style={{ marginTop: 24 }}>
        Franchise identity is canonicalized across historical team names and the verified 2005 ESPN team-ID handoff, so these are franchise-vs-franchise records rather than raw ESPN-slot totals.
      </div>
    </>
  );
}
