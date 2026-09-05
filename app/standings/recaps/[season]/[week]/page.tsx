import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';

import {
  getWeekResults, getWeekAwards, getBenchWatch, getComments, getStandings,
} from '../../../../../lib/queries.ts';
import { Comments } from '../../../../../components/Comments.tsx';
import { EspnMatchupLink, EspnTeamLink } from '../../../../../components/EspnLink.tsx';

export const dynamic = 'force-dynamic';

export default async function WeeklyRecapPage({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}) {
  const { season: rawSeason, week: rawWeek } = await params;
  const season = Number(rawSeason);
  const week = Number(rawWeek);
  if (!Number.isInteger(season) || season < 2018 || season > 2100 ||
      !Number.isInteger(week) || week < 1 || week > 18) {
    notFound();
  }

  const { userId } = await auth();
  const [games, awards, bench, comments, table] = await Promise.all([
    getWeekResults(season, week),
    getWeekAwards(season, week),
    getBenchWatch(season, week),
    userId ? getComments(season, week) : Promise.resolve([]),
    getStandings(season, week),
  ]);

  // A recap is an archived settled week, not a generic schedule page. Refuse
  // future/unsettled weeks and typo URLs rather than rendering a convincing
  // but empty historical record.
  if (games.length === 0 || table.length === 0) notFound();

  const award = (key: string) => awards.find((a) => a.award_key === key);
  const worstBench = bench[0];

  return (
    <>
      <p className="note" style={{ marginBottom: 12 }}>
        <a href={`/standings?season=${season}`}>← {season} standings &amp; weekly recaps</a>
      </p>

      <div className="page-hero">
        <div className="eyebrow">{season} weekly recap</div>
        <h1>Week {week}, settled.</h1>
        <p>Final scores, weekly indignities, and the standings after the dust cleared.</p>
      </div>

      <div className="card">
        {games.map((g) => {
          const homeWon = g.winner === 'HOME';
          const awayWon = g.winner === 'AWAY';
          return (
            <div className="match" key={g.espn_matchup_id}>
              <div className={`side ${awayWon ? 'win' : g.is_final ? 'lose' : ''}`}>
                <span>
                  {g.away_name}
                  <EspnTeamLink teamId={g.away_team_id} season={season} />
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{g.away_points ?? '—'}</span>
              </div>
              <span className="vs">
                at
                <EspnMatchupLink season={season} week={week}
                                 teamId={g.away_team_id} label="ESPN" />
              </span>
              <div className={`side ${homeWon ? 'win' : g.is_final ? 'lose' : ''}`}>
                <span>
                  {g.home_name}
                  <EspnTeamLink teamId={g.home_team_id} season={season} />
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{g.home_points ?? '—'}</span>
              </div>
            </div>
          );
        })}
      </div>

      <h2>Awards</h2>
      <div className="card">
        <table>
          <tbody>
            {award('high_scorer') && (
              <tr><td>Highest score</td>
                  <td className="tname">{award('high_scorer')!.name}</td>
                  <td className="num">{award('high_scorer')!.value}</td></tr>
            )}
            {award('low_scorer') && (
              <tr><td>Lowest score</td>
                  <td className="tname">{award('low_scorer')!.name}</td>
                  <td className="num">{award('low_scorer')!.value}</td></tr>
            )}
            {award('blowout') && (
              <tr><td>Biggest blowout</td>
                  <td className="tname">{award('blowout')!.name}</td>
                  <td className="num">+{award('blowout')!.value}</td></tr>
            )}
            {award('nailbiter') && (
              <tr><td>Heartbreaking loss</td>
                  <td className="tname">{award('nailbiter')!.name}</td>
                  <td className="num">−{award('nailbiter')!.value}</td></tr>
            )}
            {worstBench?.points_left_on_bench && Number(worstBench.points_left_on_bench) > 0 && (
              <tr><td>Worst bench decision</td>
                  <td className="tname">{worstBench.name}</td>
                  <td className="num">−{worstBench.points_left_on_bench}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Points left on the bench</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Team</th><th className="num">Actual</th><th className="num">Best</th><th className="num">Wasted</th></tr>
          </thead>
          <tbody>
            {bench.slice(0, 5).map((b) => (
              <tr key={b.name}>
                <td className="tname">{b.name}</td>
                <td className="num">{b.points_for}</td>
                <td className="num">{b.optimal_points ?? '—'}</td>
                <td className="num">{b.points_left_on_bench ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note" style={{ marginTop: 10 }}>
          &ldquo;Best&rdquo; is the highest-scoring legal lineup from the players already on
          the roster that week. It only judges start/sit calls — it does not count
          players who were sitting on waivers.
        </p>
      </div>

      <h2>Standings after week {week}</h2>
      <div className="card">
        <table>
          <tbody>
            {table.slice(0, 10).map((r, i) => (
              <tr key={r.espn_team_id}>
                <td className="rank">{i + 1}</td>
                <td><a href={`/team/${r.espn_team_id}`} className="tname">{r.name}</a></td>
                <td className="num">{r.wins}-{r.losses}</td>
                <td className="num">{r.points_for}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Comments season={season} week={week} comments={comments} me={userId ?? null} />
    </>
  );
}
