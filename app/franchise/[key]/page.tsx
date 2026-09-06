import { notFound } from 'next/navigation';

import { EspnTeamLink } from '../../../components/EspnLink.tsx';
import { HistoryNav } from '../../../components/HistoryNav.tsx';
import { espnTeamUrl } from '../../../lib/espn-links.ts';
import { getCachedFranchiseByKey } from '../../../lib/history-cache.ts';
import { finish, managerHref, pointsPerGame, record, seasonHref, winRate } from '../../../lib/history-format.ts';
import {
  getFranchiseGameMoments,
  getFranchiseSeasonMetrics,
  type HistoryGameMoment,
} from '../../../lib/history-profile-queries.ts';
import { getCurrentSeason } from '../../../lib/queries.ts';
import { getCachedRegularSeasonChampions } from '../../../lib/regular-season-history.ts';

export const revalidate = 3600;

const POSITIONS: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST',
};

function signed(value: string | null) {
  if (value === null) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
}

function receipt(label: string, row: HistoryGameMoment | undefined) {
  if (!row) return null;
  const margin = Number(row.margin);
  return (
    <div>
      <span>{label}</span>
      <strong>{row.points_for}–{row.points_against}</strong>
      <small className="block note">
        <a href={seasonHref(row.season)}>{row.season} week {row.week}</a> vs. {row.opponent_name}
        {row.playoff_tier ? ' · postseason' : ''}
        {label !== 'Highest score' ? ` · ${margin > 0 ? '+' : ''}${margin.toFixed(1)}` : ''}
      </small>
    </div>
  );
}

export default async function FranchisePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [[identity, bySeason, managers, keyPlayers], regularSeasonChampions, metrics, moments] = await Promise.all([
    getCachedFranchiseByKey(key),
    getCachedRegularSeasonChampions(),
    getFranchiseSeasonMetrics(key),
    getFranchiseGameMoments(key),
  ]);
  if (!identity || bySeason.length === 0) notFound();

  const currentSeason = await getCurrentSeason();
  const regularSeasonTitleSeasons = new Set(
    regularSeasonChampions
      .filter((row) => row.franchise_key === identity.franchise_key)
      .map((row) => row.season)
  );
  const totals = bySeason.reduce(
    (sum, season) => ({
      wins: sum.wins + season.wins,
      losses: sum.losses + season.losses,
      ties: sum.ties + season.ties,
      playoffWins: sum.playoffWins + season.playoff_wins,
      playoffLosses: sum.playoffLosses + season.playoff_losses,
      titles: sum.titles + (season.is_champion ? 1 : 0),
      finals: sum.finals + (season.is_champion || season.is_runner_up ? 1 : 0),
      berths: sum.berths + (season.final_place !== null && season.final_place <= 6 ? 1 : 0),
    }),
    { wins: 0, losses: 0, ties: 0, playoffWins: 0, playoffLosses: 0, titles: 0, finals: 0, berths: 0 }
  );

  const playersBySeason = new Map<number, typeof keyPlayers>();
  for (const player of keyPlayers) {
    const rows = playersBySeason.get(player.season) ?? [];
    rows.push(player);
    playersBySeason.set(player.season, rows);
  }
  const metricBySeason = new Map(metrics.map((row) => [row.season, row]));
  const momentByKind = new Map(moments.map((row) => [row.kind, row]));
  const bestPower = metrics
    .filter((row) => row.power_rank !== null)
    .sort((a, b) => (a.power_rank ?? 999) - (b.power_rank ?? 999) || Number(b.power_score ?? 0) - Number(a.power_score ?? 0))[0] ?? null;

  const chronological = [...bySeason].reverse();
  const milestones: Array<{ season: number; text: string }> = [];
  chronological.forEach((season, index) => {
    const previous = chronological[index - 1];
    if (!previous) milestones.push({ season: season.season, text: `Enters the record as ${season.team_name}.` });
    else {
      if (season.team_name !== previous.team_name) milestones.push({ season: season.season, text: `Renamed ${season.team_name}.` });
      if (season.manager && season.manager !== previous.manager) milestones.push({ season: season.season, text: `${season.manager} takes over.` });
    }
    if (regularSeasonTitleSeasons.has(season.season)) milestones.push({ season: season.season, text: 'Wins the regular season.' });
    if (season.is_champion) milestones.push({ season: season.season, text: 'Wins the league championship.' });
    else if (season.is_runner_up) milestones.push({ season: season.season, text: 'Reaches the championship game.' });
  });

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Permanent franchise · est. {chronological[0]!.season}</div>
        <h1>{identity.current_name}</h1>
        <p>{managers[0]?.display_name ? `Current manager: ${managers[0].display_name}` : 'Permanent league franchise'}</p>
        {identity.espn_team_id && (
          <p style={{ marginTop: 12 }}>
            <a className="btn btn-quiet" href={espnTeamUrl(identity.espn_team_id, currentSeason)} target="_blank" rel="noopener noreferrer">
              Current roster on ESPN ↗
            </a>
          </p>
        )}
      </div>

      <HistoryNav />

      <div className="stat-strip">
        <div><span>Regular season</span><strong>{record(totals.wins, totals.losses, totals.ties)}</strong></div>
        <div><span>Playoffs</span><strong>{totals.playoffWins}-{totals.playoffLosses}</strong></div>
        <div><span>Regular-season titles</span><strong>{regularSeasonTitleSeasons.size}</strong></div>
        <div><span>League titles</span><strong>{totals.titles}</strong></div>
      </div>

      <h2>Franchise snapshot</h2>
      <div className="card">
        <div className="stat-strip" style={{ margin: 0 }}>
          <div><span>Seasons</span><strong>{bySeason.length}</strong></div>
          <div><span>Win percentage</span><strong>{(winRate(totals.wins, totals.losses, totals.ties) * 100).toFixed(1)}%</strong></div>
          <div><span>Playoff berths</span><strong>{totals.berths}</strong></div>
          <div><span>Finals</span><strong>{totals.finals}</strong></div>
        </div>
        {bestPower && (
          <p className="note" style={{ marginBottom: 0 }}>
            Best final power rank: <a href={`/rankings?season=${bestPower.season}`}>#{bestPower.power_rank} in {bestPower.season}</a> using the current model.
          </p>
        )}
      </div>

      {moments.length > 0 && (
        <>
          <h2>Franchise receipts</h2>
          <p className="sub">Recovered weekly scores make these comparable all the way back to the franchise&rsquo;s first season.</p>
          <div className="stat-strip three">
            {receipt('Highest score', momentByKind.get('highest_score'))}
            {receipt('Biggest win', momentByKind.get('biggest_win'))}
            {receipt('Closest game', momentByKind.get('closest_game'))}
          </div>
        </>
      )}

      <h2>Identity &amp; eras</h2>
      <p className="sub">Names belong to seasons; managers belong to tenures; the franchise record persists through both.</p>
      <div className="card">
        <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
          {milestones.map((event, index) => (
            <div key={`${event.season}-${index}`}>
              <a className="tname" href={seasonHref(event.season)}>{event.season}</a>
              <span style={{ marginLeft: 10 }}>{event.text}</span>
            </div>
          ))}
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Manager</th><th>Years</th><th className="num">Regular</th><th className="num">Win %</th><th className="num">Playoffs</th><th className="num">Titles</th></tr>
            </thead>
            <tbody>
              {managers.map((manager) => (
                <tr key={manager.manager_key}>
                  <td><a className="tname" href={managerHref(manager.manager_key)}>{manager.display_name}</a></td>
                  <td>{manager.first_season}–{manager.last_season}<span className="tsub block">{manager.seasons} seasons</span></td>
                  <td className="num">{record(manager.regular_wins, manager.regular_losses, manager.regular_ties)}</td>
                  <td className="num">{(winRate(manager.regular_wins, manager.regular_losses, manager.regular_ties) * 100).toFixed(1)}</td>
                  <td className="num">{manager.playoff_wins}-{manager.playoff_losses}</td>
                  <td className="num">{manager.championships}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>Season by season</h2>
      <p className="sub">One durable franchise record, with historical team names and managers preserved.</p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Season</th><th>Team / manager</th><th className="num">Record</th><th className="num">PF/G</th>
                <th className="num">Power</th><th className="num">Luck</th><th className="num">Finish</th>
              </tr>
            </thead>
            <tbody>
              {bySeason.map((season) => {
                const metric = metricBySeason.get(season.season);
                return (
                  <tr key={season.season} className={season.is_champion ? 'title-row' : undefined}>
                    <td><a href={seasonHref(season.season)} className="tname">{season.season}</a></td>
                    <td>
                      {season.team_name}
                      {regularSeasonTitleSeasons.has(season.season) && <span className="tag era">Regular-season champ</span>}
                      {season.is_champion && <span className="tag best">Champion</span>}
                      {season.is_runner_up && <span className="tag era">Runner-up</span>}
                      {identity.espn_team_id && season.season >= 2018 && <EspnTeamLink teamId={identity.espn_team_id} season={season.season} />}
                      {season.manager_key && season.manager && <span className="tsub block">Manager: <a href={managerHref(season.manager_key)}>{season.manager}</a></span>}
                      {(playersBySeason.get(season.season) ?? []).length > 0 && (
                        <span className="tsub block">
                          {(playersBySeason.get(season.season) ?? []).map((player, index) => (
                            <span key={`${player.full_name}-${index}`}>
                              {index > 0 && ' · '}{player.full_name}
                              {player.position_id !== null && POSITIONS[player.position_id] ? ` (${POSITIONS[player.position_id]})` : ''} <strong>{player.points}</strong>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="num">{record(season.wins, season.losses, season.ties)}</td>
                    <td className="num">{pointsPerGame(season.points_for, season.wins, season.losses, season.ties)?.toFixed(1) ?? '—'}</td>
                    <td className="num">{metric?.power_rank ? <a href={`/rankings?season=${season.season}`}>#{metric.power_rank}</a> : '—'}</td>
                    <td className="num" title="Actual wins minus all-play expected wins">{signed(metric?.luck_delta ?? null)}</td>
                    <td className="num">
                      {season.final_place && season.final_place <= 6
                        ? <>{season.playoff_wins}-{season.playoff_losses}<span className="tsub block">{finish(season.final_place)}</span></>
                        : <span className="tsub">missed</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">Power and luck are score-derived and can use the recovered 2005–2017 weekly boards. Top-player lines begin in 2018 because ESPN no longer serves the older lineup entries.</p>
      </div>
    </>
  );
}
