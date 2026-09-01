import { auth } from '@clerk/nextjs/server';
import {
  getCurrentSeason, getPlayedSeasons, getWeekResults, getWeekAwards,
  getBenchWatch, getComments, getStandings,
} from '../lib/queries.ts';
import { Comments } from '../components/Comments.tsx';
import { asPublic } from '../lib/db.ts';

export const dynamic = 'force-dynamic';

/**
 * The latest played week OF THE CURRENT SEASON.
 *
 * Deliberately not "the newest season that has results anywhere": before week 1
 * that answer is last season's finale, and the front page spent the whole
 * preseason insisting week 14 had just been settled. A season with no results
 * yet returns null, which is week zero.
 */
async function latestPlayedWeek(season: number) {
  const rows = await asPublic<{ week: number | null }>(
    `select max(week)::int as week from public.team_week_results where season = $1`,
    [season]
  );
  const week = rows[0]?.week;
  return typeof week === 'number' && week > 0 ? week : null;
}

/** Week zero: no games yet, so lead with what the league already argues about. */
async function preseason() {
  const [rows] = await Promise.all([
    asPublic<{
      season: number; champion_name: string | null; champion_team_name: string | null;
      titles: number | null; kickoff: string | null;
    }>(
      `select c.season, c.champion_name, c.champion_team_name,
              (select count(*) from public.franchise_seasons
                where franchise_key = c.champion_key and is_champion) as titles,
              (select min(first_kickoff_at)::text from public.weeks
                where season = (select max(season) from public.seasons)) as kickoff
         from public.season_champions c
        order by c.season desc limit 1`
    ),
  ]);
  return rows[0] ?? null;
}

export default async function Home() {
  const { userId } = await auth();
  const currentSeason = await getCurrentSeason();
  const week = await latestPlayedWeek(currentSeason);

  if (week === null) {
    const [seasons, last] = await Promise.all([getPlayedSeasons(), preseason()]);
    const kickoff = last?.kickoff ? new Date(last.kickoff) : null;
    const days = kickoff
      ? Math.max(0, Math.ceil((kickoff.getTime() - Date.now()) / 86_400_000))
      : null;
    return (
      <>
        <div className="page-hero">
          <div className="eyebrow">{currentSeason} season</div>
          <h1>{days === null ? 'Season on the clock.'
            : days === 0 ? 'Kickoff is today.'
              : `${days} day${days === 1 ? '' : 's'} until kickoff.`}</h1>
          <p>
            Nobody has lost yet. Ten teams, five matchups a week, and one trophy
            that has changed hands {seasons.length > 0 ? 'plenty of times' : 'before'}.
          </p>
        </div>

        <div className="stat-strip three">
          <div>
            <strong>{last?.champion_name ?? '—'}</strong>
            <span>Defending champion{last ? ` (${last.season})` : ''}</span>
          </div>
          <div>
            <strong>{last?.titles ?? '—'}</strong>
            <span>Titles for that franchise</span>
          </div>
          <div>
            <strong>{currentSeason - 2005}</strong>
            <span>Seasons of grudges</span>
          </div>
        </div>

        <div className="card">
          <p className="note">
            Week 1 picks are open now — <strong>they lock Saturday at midnight ET</strong>,
            the midnight between Saturday and Sunday. After week 1 this page turns
            into the weekly recap: scores, awards, who left the most points on their
            bench, and the argument thread.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <a href="/predictions" className="btn">Make your week 1 picks</a>
            <a href="/history" className="btn btn-quiet">All-time records</a>
            <a href="/standings" className="btn btn-quiet">Season books</a>
          </div>
        </div>
      </>
    );
  }

  const season = currentSeason;
  const [games, awards, bench, comments, table] = await Promise.all([
    getWeekResults(season, week),
    getWeekAwards(season, week),
    getBenchWatch(season, week),
    userId ? getComments(season, week) : Promise.resolve([]),
    getStandings(season, week),
  ]);

  const award = (k: string) => awards.find((a) => a.award_key === k);
  const worstBench = bench[0];

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">{season} scoreboard</div>
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
                <span>{g.away_name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{g.away_points ?? '—'}</span>
              </div>
              <span className="vs">at</span>
              <div className={`side ${homeWon ? 'win' : g.is_final ? 'lose' : ''}`}>
                <span>{g.home_name}</span>
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
              <tr><td>Closest game</td>
                  <td className="tname">{award('nailbiter')!.name}</td>
                  <td className="num">+{award('nailbiter')!.value}</td></tr>
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
