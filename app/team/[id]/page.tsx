import { getCachedFranchiseFile } from '../../../lib/cached-queries.ts';
import { getTeams, getRivalries, getCurrentSeason } from '../../../lib/queries.ts';
import { espnTeamUrl } from '../../../lib/espn-links.ts';
import { EspnTeamLink } from '../../../components/EspnLink.tsx';

export const revalidate = 3600;

function record(wins: number, losses: number, ties: number) {
  return `${wins}-${losses}${ties ? `-${ties}` : ''}`;
}

/** ESPN position ids, for labelling a key player. */
const POSITIONS: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST',
};

function finish(place: number | null) {
  if (place === null) return null;
  if (place === 1) return 'Champion';
  if (place === 2) return 'Runner-up';
  if (place <= 4) return 'Lost semifinal';
  if (place <= 6) return 'Lost first round';
  return `${place}th`;
}

export default async function Team({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  const season = await getCurrentSeason();
  const teams = await getTeams(season);
  const team = teams.find((t) => t.espn_team_id === teamId);
  if (!team) return <p className="empty">No such team.</p>;

  const [rivals, [bySeason, managers, keyPlayers]] = await Promise.all([
    getRivalries(teamId),
    getCachedFranchiseFile(teamId),
  ]);

  const totals = bySeason.reduce(
    (sum, s) => ({
      wins: sum.wins + s.wins, losses: sum.losses + s.losses, ties: sum.ties + s.ties,
      playoffWins: sum.playoffWins + s.playoff_wins,
      playoffLosses: sum.playoffLosses + s.playoff_losses,
      titles: sum.titles + (s.is_champion ? 1 : 0),
      points: sum.points + Number(s.points_for ?? 0),
    }),
    { wins: 0, losses: 0, ties: 0, playoffWins: 0, playoffLosses: 0, titles: 0, points: 0 }
  );

  // The rivalries worth naming: most beaten, and most beaten by.
  const mostWins = rivals.reduce<typeof rivals[number] | null>(
    (best, r) => (best === null || r.wins > best.wins ? r : best), null
  );
  const mostLosses = rivals.reduce<typeof rivals[number] | null>(
    (worst, r) => (worst === null || r.losses > worst.losses ? r : worst), null
  );
  // A tie for the extreme is not an extreme worth flagging.
  const unique = (target: typeof rivals[number] | null, key: 'wins' | 'losses') =>
    target && rivals.filter((r) => r[key] === target[key]).length === 1 ? target.opp_id : null;
  const bestId = unique(mostWins, 'wins');
  const worstId = unique(mostLosses, 'losses');

  // Key players grouped by season, so the table body is a lookup rather than
  // a filter per row.
  const playersBySeason = new Map<number, typeof keyPlayers>();
  for (const p of keyPlayers) {
    const list = playersBySeason.get(p.season) ?? [];
    list.push(p);
    playersBySeason.set(p.season, list);
  }

  const current = managers[0];

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Franchise file</div>
        <h1>{team.name}</h1>
        <p>{team.owners ?? 'Unknown owner'}</p>
        {/* Straight to the live roster. This site keeps the history; ESPN keeps
            the lineup, and there is no reason to make anyone go and find it. */}
        <p style={{ marginTop: 10 }}>
          <a className="btn btn-quiet" href={espnTeamUrl(teamId, season)}
             target="_blank" rel="noopener noreferrer">
            Roster on ESPN ↗
          </a>
        </p>
      </div>

      {bySeason.length > 0 && (
        <div className="stat-strip three">
          <div>
            <span>All-time</span>
            <strong>{record(totals.wins, totals.losses, totals.ties)}</strong>
          </div>
          <div>
            <span>Seasons</span>
            <strong>{bySeason.length}</strong>
          </div>
          <div>
            <span>Titles</span>
            <strong>{totals.titles}</strong>
          </div>
        </div>
      )}

      <h2>Season by season</h2>
      <p className="sub">
        Every season the franchise has played, whoever was running it
        {bySeason.length > 0 && ` — back to ${bySeason[bySeason.length - 1]!.season}`}.
      </p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Season</th><th>Team name &amp; top scorers</th><th className="num">Record</th>
                <th className="num">PF</th><th className="num">Playoffs</th>
                <th>Manager</th>
              </tr>
            </thead>
            <tbody>
              {bySeason.map((s) => (
                <tr key={s.season} className={s.is_champion ? 'title-row' : undefined}>
                  <td>
                    <a href={`/standings?season=${s.season}`} className="tname">{s.season}</a>
                  </td>
                  <td>
                    {s.team_name}
                    {s.is_champion && <span className="tag best">Champion</span>}
                    {s.is_runner_up && <span className="tag era">Runner-up</span>}
                    {/* Straight to that season's roster on ESPN. Only the ESPN
                        era has one; the 2005-2017 archive has no team ids. */}
                    {s.season >= 2018 && (
                      <EspnTeamLink teamId={teamId} season={s.season} />
                    )}
                    {(playersBySeason.get(s.season) ?? []).length > 0 && (
                      <span className="tsub block">
                        {(playersBySeason.get(s.season) ?? []).map((p, i) => (
                          <span key={p.full_name}>
                            {i > 0 && ' · '}
                            {p.full_name}
                            {p.position_id !== null && POSITIONS[p.position_id] &&
                              ` (${POSITIONS[p.position_id]})`}{' '}
                            <strong>{p.points}</strong>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="num">{record(s.wins, s.losses, s.ties)}</td>
                  <td className="num">{s.points_for ?? '—'}</td>
                  <td className="num">
                    {s.playoff_wins + s.playoff_losses > 0 ? (
                      <>
                        {s.playoff_wins}-{s.playoff_losses}
                        <span className="tsub block">{finish(s.final_place)}</span>
                      </>
                    ) : (
                      <span className="tsub">missed</span>
                    )}
                  </td>
                  <td className="tsub">{s.manager ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Records span both eras: 2018 on from ESPN, earlier seasons from the
          commissioner&rsquo;s archive. Every win belongs to the franchise, not to
          whoever happened to be managing it.
        </p>
      </div>

      <h2>Rivalries</h2>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Opponent</th><th className="num">Record</th><th className="num">Games</th><th className="num">Since</th></tr>
            </thead>
            <tbody>
              {rivals.map((r) => (
                <tr key={r.opp_id}>
                  <td>
                    <a href={`/team/${r.opp_id}`} className="tname">{r.name}</a>
                    {r.opp_id === bestId && <span className="tag best">Most beaten</span>}
                    {r.opp_id === worstId && <span className="tag worst">Owns us</span>}
                  </td>
                  <td className="num">
                    <span className={`pill ${r.wins > r.losses ? 'w' : r.wins < r.losses ? 'l' : ''}`}>
                      {record(r.wins, r.losses, r.ties)}
                    </span>
                  </td>
                  <td className="num">{r.games}</td>
                  <td className="num">{r.first_season}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Head-to-head needs per-week scores, which only exist from 2018 on, so
          these are ESPN-era meetings only.
        </p>
      </div>

      {managers.length > 0 && (
        <>
          <h2>By manager</h2>
          <p className="sub">
            The same seasons split by who was running the franchise
            {current && ` — ${current.display_name} holds it now`}.
          </p>
          <div className="card">
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Manager</th><th className="num">Seasons</th>
                    <th className="num">Regular</th><th className="num">Win %</th>
                    <th className="num">Playoffs</th><th className="num">Berths</th>
                    <th className="num">Top 4</th><th className="num">Titles</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((m) => {
                    const games = m.regular_wins + m.regular_losses + m.regular_ties;
                    return (
                      <tr key={m.manager_key}>
                        <td>
                          <span className="tname">{m.display_name}</span>
                          <span className="tsub block">{m.first_season}–{m.last_season}</span>
                        </td>
                        <td className="num">{m.seasons}</td>
                        <td className="num">
                          {record(m.regular_wins, m.regular_losses, m.regular_ties)}
                        </td>
                        <td className="num">
                          {games
                            ? ((m.regular_wins + m.regular_ties / 2) / games * 100).toFixed(1)
                            : '—'}
                        </td>
                        <td className="num">{m.playoff_wins}-{m.playoff_losses}</td>
                        <td className="num">{m.playoff_appearances}</td>
                        <td className="num">{m.top_four}</td>
                        <td className="num">{m.championships}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
