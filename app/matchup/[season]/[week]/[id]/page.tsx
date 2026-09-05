import { notFound } from 'next/navigation';

import { EspnMatchupLink } from '../../../../../components/EspnLink.tsx';
import {
  getMatchupTeamContext,
  getRivalrySeries,
  type RivalryGame,
} from '../../../../../lib/game-context.ts';
import {
  getTeamStars,
  getWeekMatchups,
  getWeekProjections,
} from '../../../../../lib/queries.ts';
import { POSITIONS } from '../../../../../pipeline/trade.ts';

export const dynamic = 'force-dynamic';

function record(wins: number, losses: number, ties: number) {
  return `${wins}-${losses}${ties ? `-${ties}` : ''}`;
}

function viewFrom(game: RivalryGame, teamId: number) {
  const home = game.home_team_id === teamId;
  const pointsFor = Number(home ? game.home_points ?? 0 : game.away_points ?? 0);
  const pointsAgainst = Number(home ? game.away_points ?? 0 : game.home_points ?? 0);
  return { pointsFor, pointsAgainst };
}

export default async function MatchupPreview({
  params,
}: {
  params: Promise<{ season: string; week: string; id: string }>;
}) {
  const raw = await params;
  const season = Number(raw.season);
  const week = Number(raw.week);
  const matchupId = Number(raw.id);
  if (!Number.isInteger(season) || !Number.isInteger(week) || !Number.isInteger(matchupId)) notFound();

  const matchups = await getWeekMatchups(season, week);
  const matchup = matchups.find((row) => row.espn_matchup_id === matchupId);
  if (!matchup) notFound();

  const [contexts, projectionRows, starRows, rivalry] = await Promise.all([
    getMatchupTeamContext(season, week, matchup.home_team_id, matchup.away_team_id),
    getWeekProjections(season, week),
    getTeamStars(season, week),
    getRivalrySeries(matchup.away_team_id, matchup.home_team_id),
  ]);

  const byTeam = new Map(contexts.map((row) => [row.espn_team_id, row]));
  const away = byTeam.get(matchup.away_team_id);
  const home = byTeam.get(matchup.home_team_id);
  const projections = projectionRows.filter((row) => row.espn_matchup_id === matchupId);
  const awayProjection = projections.find((row) => row.espn_team_id === matchup.away_team_id);
  const homeProjection = projections.find((row) => row.espn_team_id === matchup.home_team_id);

  const stars = new Map<number, typeof starRows>();
  for (const row of starRows) {
    const list = stars.get(row.espn_team_id) ?? [];
    list.push(row);
    stars.set(row.espn_team_id, list);
  }
  const starBasis = starRows[0]?.basis ?? null;

  let awayWins = 0;
  let homeWins = 0;
  let ties = 0;
  for (const game of rivalry.games) {
    const v = viewFrom(game, matchup.away_team_id);
    if (v.pointsFor > v.pointsAgainst) awayWins += 1;
    else if (v.pointsFor < v.pointsAgainst) homeWins += 1;
    else ties += 1;
  }
  const recent = rivalry.games.slice(0, 3);
  const seriesHref = `/rivalry/${matchup.away_team_id}/${matchup.home_team_id}`;

  const teamCard = (teamId: number, name: string, ctx: typeof away) => (
    <div style={{ flex: '1 1 260px' }}>
      <div className="section-kicker">{name}</div>
      <h2 style={{ marginTop: 4 }}><a href={`/team/${teamId}`}>{name}</a></h2>
      <div className="stat-strip three">
        <div><span>Record entering week</span><strong>{ctx ? record(ctx.wins, ctx.losses, ctx.ties) : '0-0'}</strong></div>
        <div><span>Points for</span><strong>{ctx?.points_for ?? '0.0'}</strong></div>
        <div><span>Power rank</span><strong>{ctx?.power_rank ? `#${ctx.power_rank}` : '—'}</strong></div>
      </div>
      {(stars.get(teamId) ?? []).length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 14 }}>{starBasis === 'draft' ? 'Draft anchors' : 'Top starters so far'}</strong>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
            {(stars.get(teamId) ?? []).map((player) => (
              <li key={player.espn_player_id} style={{ marginBottom: 6 }}>
                <strong>{POSITIONS[player.default_position_id ?? 0] ?? '—'}</strong>{' '}
                {player.full_name ?? 'Unknown player'}
                <span className="tsub"> · {player.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">{season} · week {week} matchup preview</div>
        <h1>{matchup.away_name} at {matchup.home_name}</h1>
        <p>
          The form, the stars, ESPN&rsquo;s captured line, and the receipts from every prior meeting.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <a href="/predictions" className="btn">Back to predictions</a>
          <a href={seriesHref} className="btn btn-quiet">Full rivalry history</a>
          <EspnMatchupLink season={season} week={week} teamId={matchup.away_team_id} label="Open on ESPN" />
        </div>
      </div>

      {matchup.is_final && (
        <div className="stat-strip three">
          <div><span>{matchup.away_name}</span><strong>{matchup.away_points ?? '—'}</strong></div>
          <div><span>Final</span><strong>{matchup.winner === 'TIE' ? 'Tie' : 'Result'}</strong></div>
          <div><span>{matchup.home_name}</span><strong>{matchup.home_points ?? '—'}</strong></div>
        </div>
      )}

      {awayProjection && homeProjection && (
        <div className="card">
          <div className="section-kicker">ESPN&rsquo;s Tuesday line</div>
          <h2 style={{ marginTop: 5 }}>
            {Number(awayProjection.projected_points) === Number(homeProjection.projected_points)
              ? `Dead even at ${Number(awayProjection.projected_points).toFixed(1)}`
              : Number(awayProjection.projected_points) > Number(homeProjection.projected_points)
                ? `${matchup.away_name} ${Number(awayProjection.projected_points).toFixed(1)} · ${matchup.home_name} ${Number(homeProjection.projected_points).toFixed(1)}`
                : `${matchup.home_name} ${Number(homeProjection.projected_points).toFixed(1)} · ${matchup.away_name} ${Number(awayProjection.projected_points).toFixed(1)}`}
          </h2>
          <p className="note">
            Captured {new Date(awayProjection.captured_at).toLocaleString('en-US', {
              weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              timeZone: 'America/New_York', timeZoneName: 'short',
            })}. ESPN keeps revising projections later; this is the frozen number used by Grudge&rsquo;s prediction record.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {teamCard(matchup.away_team_id, matchup.away_name, away)}
        {teamCard(matchup.home_team_id, matchup.home_name, home)}
      </div>

      <h2>Series context</h2>
      <div className="card">
        <div className="stat-strip three">
          <div><span>{matchup.away_name}</span><strong>{awayWins}</strong><small className="block note">wins</small></div>
          <div><span>All meetings</span><strong>{rivalry.games.length}</strong><small className="block note">{ties ? `${ties} tie${ties === 1 ? '' : 's'}` : 'no ties'}</small></div>
          <div><span>{matchup.home_name}</span><strong>{homeWins}</strong><small className="block note">wins</small></div>
        </div>

        {recent.length > 0 && (
          <div className="scroll" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Recent meeting</th><th className="num">Score</th><th>Round</th></tr></thead>
              <tbody>
                {recent.map((game) => (
                  <tr key={`${game.season}-${game.espn_matchup_id}`}>
                    <td><a href={`/standings?season=${game.season}`}>{game.season} week {game.week}</a></td>
                    <td className="num">{game.away_name} {game.away_points ?? '—'} · {game.home_name} {game.home_points ?? '—'}</td>
                    <td>{game.playoff_tier ? <span className="tag era">{game.playoff_tier === 'WINNERS_BRACKET' ? 'Playoffs' : 'Consolation'}</span> : 'Regular'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note" style={{ marginTop: 10 }}>
          <a href={seriesHref}>Open the full rivalry ledger →</a>
        </p>
      </div>
    </>
  );
}
