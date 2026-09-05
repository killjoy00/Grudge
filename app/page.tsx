import { auth } from '@clerk/nextjs/server';
import {
  getCurrentSeason, getPlayedSeasons, getWeekResults, getWeekAwards,
  getBenchWatch, getComments, getStandings, getPlayoffWeek, getWeekMatchups,
} from '../lib/queries.ts';
import { getCurrentIncompleteWeek } from '../lib/game-context.ts';
import { Comments } from '../components/Comments.tsx';
import { EspnMatchupLink, EspnTeamLink } from '../components/EspnLink.tsx';
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
  const [week, activeWeek] = await Promise.all([
    latestPlayedWeek(currentSeason),
    getCurrentIncompleteWeek(currentSeason),
  ]);
  const now = Date.now();
  const activeStarted = Boolean(
    activeWeek?.first_kickoff_at && new Date(activeWeek.first_kickoff_at).getTime() <= now
  );

  // Once the first game of an incomplete week has kicked off, the previous
  // recap (or preseason countdown) is no longer the headline. The database is
  // intentionally frozen until Tuesday, so do NOT pretend these are live
  // scores; show the slate and hand off to ESPN until the pipeline settles it.
  if (activeWeek && activeStarted) {
    const games = await getWeekMatchups(currentSeason, activeWeek.week);
    const lockAt = activeWeek.locks_at ?? activeWeek.first_kickoff_at;
    const locked = lockAt ? new Date(lockAt).getTime() <= now : true;
    return (
      <>
        <div className="page-hero">
          <div className="eyebrow">{currentSeason} scoreboard</div>
          <h1>Week {activeWeek.week} is underway.</h1>
          <p>
            Grudge freezes the official week after Monday night. Until then, follow
            the games on ESPN and use the matchup files for the pregame receipts.
          </p>
        </div>

        <div className="card">
          {games.map((game) => (
            <div className="match" key={game.espn_matchup_id}>
              <div className="side">
                <span>
                  {game.away_name}
                  <EspnTeamLink teamId={game.away_team_id} season={currentSeason} />
                </span>
              </div>
              <span className="vs">
                at
                <EspnMatchupLink season={currentSeason} week={activeWeek.week}
                                 teamId={game.away_team_id} label="ESPN" />
              </span>
              <div className="side">
                <span>
                  {game.home_name}
                  <EspnTeamLink teamId={game.home_team_id} season={currentSeason} />
                </span>
              </div>
              <a
                href={`/matchup/${currentSeason}/${activeWeek.week}/${game.espn_matchup_id}`}
                className="espn-link"
                style={{ marginLeft: 8 }}
              >
                Preview
              </a>
            </div>
          ))}
        </div>

        <div className="card">
          <p className="note" style={{ margin: 0 }}>
            {locked
              ? <>Week {activeWeek.week} picks are locked. Your board stays visible while the games play.</>
              : <>Week {activeWeek.week} picks are still open until Saturday at midnight ET.</>}
          </p>
          <div style={{ marginTop: 12 }}>
            <a href="/predictions" className="btn">
              {locked ? 'Review your picks' : 'Make your picks'}
            </a>
          </div>
        </div>
      </>
    );
  }

  if (week === null) {
    const [seasons, last] = await Promise.all([getPlayedSeasons(), preseason()]);
    const kickoffValue = activeWeek?.first_kickoff_at ?? last?.kickoff ?? null;
    const kickoff = kickoffValue ? new Date(kickoffValue) : null;
    const days = kickoff ? Math.ceil((kickoff.getTime() - now) / 86_400_000) : null;
    const lockAt = activeWeek?.locks_at ?? activeWeek?.first_kickoff_at ?? null;
    const picksLocked = lockAt ? new Date(lockAt).getTime() <= now : false;
    const pickWeek = activeWeek?.week ?? 1;
    return (
      <>
        <div className="page-hero">
          <div className="eyebrow">{currentSeason} season</div>
          <h1>{days === null ? 'Season on the clock.'
            : days <= 0 ? 'Kickoff is today.'
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
            {picksLocked ? (
              <>Week {pickWeek} picks are locked — the deadline was Saturday at midnight ET.
                The prediction board stays available so you can review what you picked.</>
            ) : (
              <>Week {pickWeek} picks are open now — <strong>they lock Saturday at midnight ET</strong>,
                the midnight between Saturday and Sunday.</>
            )}{' '}
            After the games settle this page becomes the weekly recap: scores, awards,
            who left the most points on their bench, and the argument thread.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <a href="/predictions" className="btn">
              {picksLocked ? `Review week ${pickWeek} picks` : `Make your week ${pickWeek} picks`}
            </a>
            <a href="/history" className="btn btn-quiet">All-time records</a>
            <a href="/standings" className="btn btn-quiet">Season books</a>
          </div>
        </div>
      </>
    );
  }

  const season = currentSeason;

  // Once the bracket starts, the regular-season week stops being the news.
  // Nothing derived is computed for playoff weeks on purpose (they must not
  // contaminate season records), so this reads the games straight from
  // `matchups` and shows the bracket instead of a frozen week 14.
  const playoffs = await getPlayoffWeek(season);
  if (playoffs) {
    const champs = playoffs.games.filter((g) => g.playoff_tier === 'WINNERS_BRACKET');
    const rest = playoffs.games.filter((g) => g.playoff_tier !== 'WINNERS_BRACKET');
    const board = (list: typeof playoffs.games) => (
      <div className="card">
        {list.map((g) => {
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
                <EspnMatchupLink season={season} week={playoffs.week}
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
    );
    return (
      <>
        <div className="page-hero">
          <div className="eyebrow">{season} postseason</div>
          <h1>Week {playoffs.week}: the bracket.</h1>
          <p>Six teams got in. The rest of the league is watching.</p>
        </div>
        {champs.length > 0 && (
          <>
            <h2>Championship bracket</h2>
            {board(champs)}
          </>
        )}
        {rest.length > 0 && (
          <>
            <h2>Consolation</h2>
            {board(rest)}
          </>
        )}
        <div className="card">
          <p className="note">
            Awards, bench watch and the luck index are regular-season measures
            and stop at week {week}, so they are not shown here.{' '}
            <a href={`/standings?season=${season}`}>The {season} table</a> has the
            seeding the bracket came from.
          </p>
        </div>
      </>
    );
  }

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
              // The awardee is the team that LOST the closest game, so the
              // margin reads as what it cost them rather than what it won.
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