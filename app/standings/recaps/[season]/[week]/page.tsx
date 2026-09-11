import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';

import {
  getWeekResults, getWeekAwards, getBenchWatch, getComments, getStandings,
} from '../../../../../lib/queries.ts';
import { getHistoricalRecapExtras } from '../../../../../lib/historical-recap-queries.ts';
import { Comments } from '../../../../../components/Comments.tsx';
import { EspnMatchupLink, EspnTeamLink } from '../../../../../components/EspnLink.tsx';
import { franchiseHref, managerHref } from '../../../../../lib/history-format.ts';
import { getSeasonFranchiseMap } from '../../../../../lib/season-identity-queries.ts';

export const dynamic = 'force-dynamic';

export default async function WeeklyRecapPage({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}) {
  const { season: rawSeason, week: rawWeek } = await params;
  const season = Number(rawSeason);
  const week = Number(rawWeek);
  if (!Number.isInteger(season) || season < 2005 || season > 2100 ||
      !Number.isInteger(week) || week < 1 || week > 18) {
    notFound();
  }

  const historical = season < 2018;
  const { userId } = await auth();
  const [games, awards, bench, comments, table, seasonIdentities, historicalExtras] = await Promise.all([
    getWeekResults(season, week),
    getWeekAwards(season, week),
    getBenchWatch(season, week),
    userId ? getComments(season, week) : Promise.resolve([]),
    getStandings(season, week),
    getSeasonFranchiseMap(season),
    historical ? getHistoricalRecapExtras(season, week) : Promise.resolve(null),
  ]);

  // A recap is an archived settled week, not a generic schedule page. Refuse
  // future/unsettled weeks and typo URLs rather than rendering a convincing
  // but empty historical record.
  if (games.length === 0 || table.length === 0) notFound();

  const franchiseByTeam = new Map(seasonIdentities.map((row) => [row.espn_team_id, row.franchise_key]));
  const franchiseLink = (teamId: number, name: string) => {
    const key = franchiseByTeam.get(teamId);
    return key ? <a href={franchiseHref(key)}>{name}</a> : name;
  };
  const award = (key: string) => awards.find((a) => a.award_key === key);
  const hasBenchEvidence = bench.some((row) => row.optimal_points !== null || row.points_left_on_bench !== null);
  const worstBench = hasBenchEvidence ? bench[0] : undefined;
  const luckByTeam = new Map(historicalExtras?.luck.map((row) => [row.espn_team_id, row]));
  const allPlayByTeam = new Map(historicalExtras?.allPlay.map((row) => [row.espn_team_id, row]));

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

      {historical && (
        <p className="note">
          This recap is rebuilt from the recovered ESPN team-level scoreboard. Scores, opponents,
          standings, awards, power, luck and all-play are on file; weekly player ownership, starts,
          optimal lineups and bench decisions begin in 2018 and are intentionally omitted here.
        </p>
      )}

      <div className="card">
        {games.map((g) => {
          const homeWon = g.winner === 'HOME';
          const awayWon = g.winner === 'AWAY';
          return (
            <div className="match" key={g.espn_matchup_id}>
              <div className={`side ${awayWon ? 'win' : g.is_final ? 'lose' : ''}`}>
                <span>
                  {franchiseLink(g.away_team_id, g.away_name)}
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
                  {franchiseLink(g.home_team_id, g.home_name)}
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

      {hasBenchEvidence && (
        <>
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
        </>
      )}

      <h2>Standings after week {week}</h2>
      <div className="card">
        <table>
          <tbody>
            {table.slice(0, 10).map((r, i) => {
              const franchiseKey = franchiseByTeam.get(r.espn_team_id);
              return (
                <tr key={franchiseKey ?? r.espn_team_id}>
                  <td className="rank">{i + 1}</td>
                  <td>{franchiseKey
                    ? <a href={franchiseHref(franchiseKey)} className="tname">{r.name}</a>
                    : <span className="tname">{r.name}</span>}</td>
                  <td className="num">{r.wins}-{r.losses}</td>
                  <td className="num">{r.points_for}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {historicalExtras && historicalExtras.power.length > 0 && (
        <>
          <h2>Power, luck &amp; all-play after week {week}</h2>
          <div className="card">
            <div className="scroll"><table>
              <thead><tr><th className="rank">#</th><th>Team</th><th className="num">Power</th><th className="num">Luck</th><th className="num">All-play</th></tr></thead>
              <tbody>{historicalExtras.power.map((row) => {
                const luck = luckByTeam.get(row.espn_team_id);
                const allPlay = allPlayByTeam.get(row.espn_team_id);
                const luckValue = luck ? Number(luck.luck_delta) : null;
                return (
                  <tr key={row.espn_team_id}>
                    <td className="rank">{row.rank}</td>
                    <td><a className="tname" href={franchiseHref(row.franchise_key)}>{row.name}</a></td>
                    <td className="num">{row.score}</td>
                    <td className="num">{luck
                      ? `${luckValue !== null && luckValue > 0 ? '+' : ''}${luck.luck_delta}`
                      : '—'}</td>
                    <td className="num">{allPlay?.scaled_wins !== null && allPlay?.scaled_losses !== null
                      ? `${allPlay.scaled_wins}-${allPlay.scaled_losses}`
                      : allPlay ? `${allPlay.all_play_wins}-${allPlay.all_play_losses}` : '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <p className="note" style={{ marginTop: 10 }}>
              These are reconstructed from team scores and opponents only. Power uses the same model as every other season;
              luck compares actual wins with schedule-neutral expected wins; all-play is scaled to the number of games actually played.
            </p>
          </div>
        </>
      )}

      {historicalExtras?.grudge && (
        <>
          <h2>Old business</h2>
          <div className="card">
            <strong>
              <a href={managerHref(historicalExtras.grudge.home_manager_key)}>{historicalExtras.grudge.home_manager_name}</a>
              {' vs. '}
              <a href={managerHref(historicalExtras.grudge.away_manager_key)}>{historicalExtras.grudge.away_manager_name}</a>
            </strong>
            <p className="note" style={{ marginBottom: 0 }}>
              The week&rsquo;s most-established manager matchup. Through this game, the series stood{' '}
              {historicalExtras.grudge.home_wins}-{historicalExtras.grudge.away_wins}
              {historicalExtras.grudge.ties ? `-${historicalExtras.grudge.ties}` : ''} from{' '}
              {historicalExtras.grudge.home_manager_name}&rsquo;s side across {historicalExtras.grudge.games} meetings.
              In {season}, the teams were {historicalExtras.grudge.home_team_name} and {historicalExtras.grudge.away_team_name}.
            </p>
          </div>
        </>
      )}

      <Comments season={season} week={week} comments={comments} me={userId ?? null} />
    </>
  );
}
