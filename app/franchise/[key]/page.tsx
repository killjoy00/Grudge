import { notFound } from 'next/navigation';

import { EspnTeamLink } from '../../../components/EspnLink.tsx';
import { espnTeamUrl } from '../../../lib/espn-links.ts';
import { getCachedFranchiseByKey } from '../../../lib/history-cache.ts';
import { finish, managerHref, record, seasonHref, winRate } from '../../../lib/history-format.ts';
import { getCurrentSeason, getRivalries } from '../../../lib/queries.ts';
import { getCachedRegularSeasonChampions } from '../../../lib/regular-season-history.ts';

export const revalidate = 3600;

const POSITIONS: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST',
};

export default async function FranchisePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [[identity, bySeason, managers, keyPlayers], regularSeasonChampions] = await Promise.all([
    getCachedFranchiseByKey(key),
    getCachedRegularSeasonChampions(),
  ]);
  if (!identity || bySeason.length === 0) notFound();

  const rivals = identity.espn_team_id ? await getRivalries(identity.espn_team_id) : [];
  const currentSeason = await getCurrentSeason();
  const regularSeasonTitleSeasons = new Set(
    regularSeasonChampions
      .filter((row) => row.franchise_key === identity.franchise_key)
      .map((row) => row.season)
  );
  const totals = bySeason.reduce(
    (sum, s) => ({
      wins: sum.wins + s.wins,
      losses: sum.losses + s.losses,
      ties: sum.ties + s.ties,
      playoffWins: sum.playoffWins + s.playoff_wins,
      playoffLosses: sum.playoffLosses + s.playoff_losses,
      titles: sum.titles + (s.is_champion ? 1 : 0),
    }),
    { wins: 0, losses: 0, ties: 0, playoffWins: 0, playoffLosses: 0, titles: 0 }
  );

  const playersBySeason = new Map<number, typeof keyPlayers>();
  for (const player of keyPlayers) {
    const rows = playersBySeason.get(player.season) ?? [];
    rows.push(player);
    playersBySeason.set(player.season, rows);
  }

  const mostWins = rivals.reduce<typeof rivals[number] | null>(
    (best, row) => (!best || row.wins > best.wins ? row : best), null
  );
  const mostLosses = rivals.reduce<typeof rivals[number] | null>(
    (worst, row) => (!worst || row.losses > worst.losses ? row : worst), null
  );
  const uniqueExtreme = (target: typeof rivals[number] | null, field: 'wins' | 'losses') =>
    target && rivals.filter((row) => row[field] === target[field]).length === 1 ? target.opp_id : null;
  const bestId = uniqueExtreme(mostWins, 'wins');
  const worstId = uniqueExtreme(mostLosses, 'losses');

  const chronological = [...bySeason].reverse();
  const milestones: Array<{ season: number; text: string }> = [];
  chronological.forEach((season, index) => {
    const previous = chronological[index - 1];
    if (!previous) {
      milestones.push({ season: season.season, text: `Franchise enters the record as ${season.team_name}.` });
    } else {
      if (season.team_name !== previous.team_name) {
        milestones.push({ season: season.season, text: `Team name changes to ${season.team_name}.` });
      }
      if (season.manager && season.manager !== previous.manager) {
        milestones.push({ season: season.season, text: `${season.manager} takes over as manager.` });
      }
    }
    if (regularSeasonTitleSeasons.has(season.season)) {
      milestones.push({ season: season.season, text: 'Wins the regular-season championship.' });
    }
    if (season.is_champion) milestones.push({ season: season.season, text: 'Wins the league championship.' });
    else if (season.is_runner_up) milestones.push({ season: season.season, text: 'Reaches the championship game.' });
  });

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Franchise file · est. {chronological[0]!.season}</div>
        <h1>{identity.current_name}</h1>
        <p>{managers[0]?.display_name ? `Current manager: ${managers[0].display_name}` : 'Permanent league franchise'}</p>
        {identity.espn_team_id && (
          <p style={{ marginTop: 12 }}>
            <a
              href={espnTeamUrl(identity.espn_team_id, currentSeason)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                padding: '5px 9px',
                color: 'white',
                border: '1px solid #9fc8e2',
                borderRadius: 3,
                fontSize: 13,
                fontWeight: 750,
                letterSpacing: '.01em',
                textDecoration: 'none',
              }}
            >
              Roster on ESPN ↗
            </a>
          </p>
        )}
      </div>

      <div className="stat-strip">
        <div><span>All-time</span><strong>{record(totals.wins, totals.losses, totals.ties)}</strong></div>
        <div><span>Seasons</span><strong>{bySeason.length}</strong></div>
        <div><span>Regular-season titles</span><strong>{regularSeasonTitleSeasons.size}</strong></div>
        <div><span>League titles</span><strong>{totals.titles}</strong></div>
      </div>

      <h2>Franchise timeline</h2>
      <p className="sub">The handoffs, renames, regular-season crowns and title runs that changed this franchise.</p>
      <div className="card">
        <div style={{ display: 'grid', gap: 12 }}>
          {milestones.map((event, index) => (
            <div key={`${event.season}-${index}`}>
              <a className="tname" href={seasonHref(event.season)}>{event.season}</a>
              <span style={{ marginLeft: 10 }}>{event.text}</span>
            </div>
          ))}
        </div>
      </div>

      <h2>Franchise eras</h2>
      <p className="sub">Every manager who has controlled this slot, separated from the franchise record itself.</p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Manager</th><th>Years</th><th className="num">Seasons</th>
                <th className="num">Regular</th><th className="num">Win %</th>
                <th className="num">Playoffs</th><th className="num">Titles</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((manager) => (
                <tr key={manager.manager_key}>
                  <td><a className="tname" href={managerHref(manager.manager_key)}>{manager.display_name}</a></td>
                  <td>{manager.first_season}–{manager.last_season}</td>
                  <td className="num">{manager.seasons}</td>
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
      <p className="sub">Every year attached to the permanent franchise, regardless of team name or manager.</p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Season</th><th>Team name &amp; top scorers</th><th className="num">Record</th>
                <th className="num">PF</th><th className="num">Playoffs</th><th>Manager</th>
              </tr>
            </thead>
            <tbody>
              {bySeason.map((season) => (
                <tr key={season.season} className={season.is_champion ? 'title-row' : undefined}>
                  <td><a href={seasonHref(season.season)} className="tname">{season.season}</a></td>
                  <td>
                    {season.team_name}
                    {regularSeasonTitleSeasons.has(season.season) && <span className="tag era">Regular-season champ</span>}
                    {season.is_champion && <span className="tag best">Champion</span>}
                    {season.is_runner_up && <span className="tag era">Runner-up</span>}
                    {identity.espn_team_id && season.season >= 2018 && (
                      <EspnTeamLink teamId={identity.espn_team_id} season={season.season} />
                    )}
                    {(playersBySeason.get(season.season) ?? []).length > 0 && (
                      <span className="tsub block">
                        {(playersBySeason.get(season.season) ?? []).map((player, index) => (
                          <span key={`${player.full_name}-${index}`}>
                            {index > 0 && ' · '}
                            {player.full_name}
                            {player.position_id !== null && POSITIONS[player.position_id] ? ` (${POSITIONS[player.position_id]})` : ''}{' '}
                            <strong>{player.points}</strong>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="num">{record(season.wins, season.losses, season.ties)}</td>
                  <td className="num">{season.points_for ?? '—'}</td>
                  <td className="num">
                    {season.final_place && season.final_place <= 6 ? (
                      <>
                        {season.playoff_wins}-{season.playoff_losses}
                        <span className="tsub block">{finish(season.final_place)}</span>
                      </>
                    ) : <span className="tsub">missed</span>}
                  </td>
                  <td>
                    {season.manager_key && season.manager
                      ? <a href={managerHref(season.manager_key)}>{season.manager}</a>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {rivals.length > 0 && identity.espn_team_id && (
        <>
          <h2>Rivalries</h2>
          <div className="card">
            <div className="scroll">
              <table>
                <thead>
                  <tr><th>Opponent</th><th className="num">Record</th><th className="num">Games</th><th className="num">Since</th></tr>
                </thead>
                <tbody>
                  {rivals.map((rival) => (
                    <tr key={rival.opp_id}>
                      <td>
                        <a href={`/team/${rival.opp_id}`} className="tname">{rival.name}</a>
                        {rival.opp_id === bestId && <span className="tag best">Most beaten</span>}
                        {rival.opp_id === worstId && <span className="tag worst">Owns us</span>}
                        <a href={`/rivalry/${identity.espn_team_id}/${rival.opp_id}`} className="tsub block">Full series →</a>
                      </td>
                      <td className="num">{record(rival.wins, rival.losses, rival.ties)}</td>
                      <td className="num">{rival.games}</td>
                      <td className="num">{rival.first_season}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">Head-to-head detail begins in 2018 because the older commissioner archive has season totals, not weekly opponents.</p>
          </div>
        </>
      )}
    </>
  );
}
