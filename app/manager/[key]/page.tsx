import { notFound } from 'next/navigation';

import { HistoryNav } from '../../../components/HistoryNav.tsx';
import { getCachedManagerFile } from '../../../lib/history-cache.ts';
import { finish, franchiseHref, managerHref, pointsPerGame, record, seasonHref, winRate } from '../../../lib/history-format.ts';
import {
  getManagerGameMoments,
  getManagerRegularSeasonTitleSeasons,
  getManagerSeasonMetrics,
  type HistoryGameMoment,
} from '../../../lib/history-profile-queries.ts';
import { getManagerGrudges } from '../../../lib/rivalry-queries.ts';

export const revalidate = 86400;

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

export default async function ManagerPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [[profile, seasons], metrics, moments, regularTitles, grudges] = await Promise.all([
    getCachedManagerFile(key),
    getManagerSeasonMetrics(key),
    getManagerGameMoments(key),
    getManagerRegularSeasonTitleSeasons(key),
    getManagerGrudges(key),
  ]);
  if (!profile || seasons.length === 0) notFound();

  const metricBySeason = new Map(metrics.map((row) => [row.season, row]));
  const momentByKind = new Map(moments.map((row) => [row.kind, row]));
  const bestSeason = [...seasons].sort((a, b) => {
    const rateDiff = winRate(b.wins, b.losses, b.ties) - winRate(a.wins, a.losses, a.ties);
    if (rateDiff !== 0) return rateDiff;
    return (pointsPerGame(b.points_for, b.wins, b.losses, b.ties) ?? 0)
      - (pointsPerGame(a.points_for, a.wins, a.losses, a.ties) ?? 0);
  })[0]!;
  const bestPower = metrics
    .filter((row) => row.power_rank !== null)
    .sort((a, b) => (a.power_rank ?? 999) - (b.power_rank ?? 999) || Number(b.power_score ?? 0) - Number(a.power_score ?? 0))[0] ?? null;
  const franchiseKeys = [...new Set(seasons.map((season) => season.franchise_key))];

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Manager career · {profile.first_season}–{profile.last_season}</div>
        <h1>{profile.display_name}</h1>
        <p>{profile.seasons} seasons across {franchiseKeys.length} franchise{franchiseKeys.length === 1 ? '' : 's'}.</p>
      </div>

      <HistoryNav />

      <div className="stat-strip">
        <div><span>Regular season</span><strong>{record(profile.regular_wins, profile.regular_losses, profile.regular_ties)}</strong></div>
        <div><span>Playoffs</span><strong>{profile.playoff_wins}-{profile.playoff_losses}</strong></div>
        <div><span>Regular-season titles</span><strong>{regularTitles.length}</strong></div>
        <div><span>League titles</span><strong>{profile.championships}</strong></div>
      </div>

      <h2>Career snapshot</h2>
      <div className="card">
        <div className="stat-strip" style={{ margin: 0 }}>
          <div><span>Win percentage</span><strong>{(winRate(profile.regular_wins, profile.regular_losses, profile.regular_ties) * 100).toFixed(1)}%</strong></div>
          <div><span>Playoff berths</span><strong>{profile.playoff_appearances}</strong></div>
          <div><span>Finals</span><strong>{profile.championships + profile.runner_ups}</strong></div>
          <div><span>Top-four finishes</span><strong>{profile.top_four}</strong></div>
        </div>
        <p className="note" style={{ marginBottom: 0 }}>
          Best regular season: <a href={seasonHref(bestSeason.season)}>{bestSeason.season}</a> at{' '}
          <strong>{record(bestSeason.wins, bestSeason.losses, bestSeason.ties)}</strong>
          {bestSeason.is_champion ? ' with a championship.' : '.'}
          {bestPower && (
            <> Best final power rank: <a href={`/rankings?season=${bestPower.season}`}>#{bestPower.power_rank} in {bestPower.season}</a>.</>
          )}
        </p>
        {regularTitles.length > 0 && (
          <p className="note" style={{ marginBottom: 0 }}>
            Regular-season crowns: {regularTitles.map((row, index) => (
              <span key={row.season}>{index > 0 && ' · '}<a href={seasonHref(row.season)}>{row.season}</a></span>
            ))}
          </p>
        )}
      </div>

      {moments.length > 0 && (
        <>
          <h2>Career receipts</h2>
          <p className="sub">Team-level weekly evidence follows the manager across every franchise they controlled.</p>
          <div className="stat-strip three">
            {receipt('Highest score', momentByKind.get('highest_score'))}
            {receipt('Biggest win', momentByKind.get('biggest_win'))}
            {receipt('Closest game', momentByKind.get('closest_game'))}
          </div>
        </>
      )}

      <h2>Season by season</h2>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Season</th><th>Franchise / team</th><th className="num">Record</th>
                <th className="num">PF/G</th><th className="num">Power</th>
                <th className="num">Luck</th><th className="num">Finish</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((season) => {
                const metric = metricBySeason.get(season.season);
                return (
                  <tr key={`${season.season}-${season.franchise_key}`} className={season.is_champion ? 'title-row' : undefined}>
                    <td><a className="tname" href={seasonHref(season.season)}>{season.season}</a></td>
                    <td>
                      <a href={franchiseHref(season.franchise_key)}>{season.current_name}</a>
                      <span className="tsub block">{season.team_name}</span>
                      {season.is_champion && <span className="tag best">Champion</span>}
                      {season.is_runner_up && <span className="tag era">Runner-up</span>}
                    </td>
                    <td className="num">{record(season.wins, season.losses, season.ties)}</td>
                    <td className="num">{pointsPerGame(season.points_for, season.wins, season.losses, season.ties)?.toFixed(1) ?? '—'}</td>
                    <td className="num">
                      {metric?.power_rank ? <a href={`/rankings?season=${season.season}`}>#{metric.power_rank}</a> : '—'}
                    </td>
                    <td className="num" title="Actual wins minus all-play expected wins">{signed(metric?.luck_delta ?? null)}</td>
                    <td className="num">
                      {season.final_place !== null && season.final_place <= 6
                        ? <>{season.playoff_wins}-{season.playoff_losses}<span className="tsub block">{finish(season.final_place)}</span></>
                        : <span className="tsub">missed</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">Power and luck use the same score-based formulas for every season with a recovered weekly scoreboard. Player/bench metrics remain unavailable before 2018.</p>
      </div>

      {grudges.length > 0 && (
        <>
          <h2>Grudges</h2>
          <p className="sub">The opponent is another manager, not a franchise. This record follows both people through team changes.</p>
          <div className="card">
            <div className="scroll">
              <table>
                <thead><tr><th>Opponent</th><th className="num">Record</th><th className="num">Games</th><th className="num">Playoffs</th><th className="num">Since</th></tr></thead>
                <tbody>{grudges.map((grudge) => (
                  <tr key={grudge.opp_key}>
                    <td>
                      <a className="tname" href={managerHref(grudge.opp_key)}>{grudge.name}</a>
                      <a className="tsub block" href={`/grudge/${encodeURIComponent(key)}/${encodeURIComponent(grudge.opp_key)}`}>Full grudge →</a>
                    </td>
                    <td className="num">{record(grudge.wins, grudge.losses, grudge.ties)}</td>
                    <td className="num">{grudge.games}</td>
                    <td className="num">{grudge.playoff_games ? `${grudge.playoff_wins}-${grudge.playoff_losses}` : '—'}</td>
                    <td className="num">{grudge.first_season}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="note"><a href="/history/rivalries">Open the league-wide Grudges record book →</a></p>
          </div>
        </>
      )}

      {franchiseKeys.length > 1 && (
        <>
          <h2>Franchises managed</h2>
          <div className="card">
            {franchiseKeys.map((franchiseKey) => {
              const sample = seasons.find((season) => season.franchise_key === franchiseKey)!;
              const years = seasons.filter((season) => season.franchise_key === franchiseKey).map((season) => season.season);
              return (
                <p key={franchiseKey} style={{ margin: '8px 0' }}>
                  <a className="tname" href={franchiseHref(franchiseKey)}>{sample.current_name}</a>{' '}
                  <span className="tsub">{Math.min(...years)}–{Math.max(...years)}</span>
                </p>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
