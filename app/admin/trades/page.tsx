/**
 * Trade finder.
 *
 * Every mutually beneficial one-for-one swap available between the league's
 * current rosters, ranked so the most acceptable offer leads.
 *
 * The page runs the model on each visit rather than caching it -- rosters move
 * daily, and a cached trade board is a board that suggests deals for players
 * who have already been dropped. It is admin-only and the search is small
 * (ten rosters, ~16 players each), so recomputing is cheaper than explaining
 * a stale answer.
 *
 * Gains are the change in expected weekly STARTING points, not player value:
 * a trade that improves a roster on paper but cannot crack the lineup is worth
 * nothing, and this model says so.
 */
import { notFound } from 'next/navigation';

import { adminProfile } from '../../../lib/admin.ts';
import { getCurrentSeason, getTeams } from '../../../lib/queries.ts';
import { tradeReport } from '../../../lib/trade-queries.ts';

export const dynamic = 'force-dynamic';

function signed(n: number) {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
}

export default async function AdminTrades({
  searchParams,
}: { searchParams: Promise<{ team?: string; season?: string }> }) {
  if (!(await adminProfile())) notFound();

  const sp = await searchParams;
  const current = await getCurrentSeason();
  const season = Number(sp.season) || current;
  const teamFilter = Number(sp.team) || null;

  const [result, teams] = await Promise.all([
    tradeReport(season, teamFilter),
    getTeams(season),
  ]);

  const filterBar = (
    <div className="card">
      <strong style={{ fontSize: 14 }}>Filter to one team</strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <a href="/admin/trades"
           className={`btn${teamFilter === null ? '' : ' btn-quiet'}`}
           style={{ padding: '6px 12px' }}>
          All teams
        </a>
        {teams.map((t) => (
          <a key={t.espn_team_id} href={`/admin/trades?team=${t.espn_team_id}`}
             className={`btn${teamFilter === t.espn_team_id ? '' : ' btn-quiet'}`}
             style={{ padding: '6px 12px' }}>
            {t.name}
          </a>
        ))}
      </div>
    </div>
  );

  if (!result.ok) {
    const { weeks, required } = result.refusal;
    return (
      <>
        <h1>Trade finder</h1>
        <p className="sub">{season} season</p>
        <div className="callout">
          <strong>
            {weeks === 0
              ? 'No weeks have been played yet.'
              : `Only ${weeks} played week${weeks === 1 ? '' : 's'} so far.`}
          </strong>{' '}
          Replacement levels are measured from what players have actually
          scored, and {weeks < 2 ? 'that little' : `${weeks} week${weeks === 1 ? '' : 's'}`} of
          it is noise. The model refuses below {required} weeks rather than
          printing something that would look just as confident and mean nothing.
        </div>
      </>
    );
  }

  const { report } = result;
  const name = (id: number) => report.teams.get(id) ?? `Team ${id}`;

  return (
    <>
      <h1>Trade finder</h1>
      <p className="sub">
        {report.suggestions.length} mutually beneficial 1-for-1 trade
        {report.suggestions.length === 1 ? '' : 's'} · rosters as of week{' '}
        {report.throughWeek} · {report.weeks} weeks of scoring · {report.players} players
      </p>

      {filterBar}

      <h2>Replacement level</h2>
      <p className="sub">
        The points-per-game bar a player has to clear to be worth anything at
        all. Set by how many of each position the league actually starts every
        week, not by a ranking.
      </p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Position</th>
                <th className="num">Replacement ppg</th>
                <th className="num">Started league-wide</th>
              </tr>
            </thead>
            <tbody>
              {report.levels.map((l) => (
                <tr key={l.position}>
                  <td className="tname">{l.position}</td>
                  <td className="num">{l.ppg.toFixed(2)}</td>
                  <td className="num">{l.startedPerWeek.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>Suggested trades</h2>
      {report.suggestions.length === 0 ? (
        <div className="callout">
          Nothing to suggest{teamFilter !== null && ` for ${name(teamFilter)}`}.
          That is a real answer rather than a failure — these rosters have no
          complementary surplus to swap. A trade only appears here when it makes
          BOTH lineups stronger.
        </div>
      ) : (
        <div className="card">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Sends</th>
                  <th>Gets</th>
                  <th className="num">Their gain</th>
                  <th className="num">Other side</th>
                </tr>
              </thead>
              <tbody>
                {report.suggestions.map((t, i) => {
                  const a = t.aGives[0];
                  const b = t.bGives[0];
                  if (!a || !b) return null;
                  return (
                    <tr key={`${t.teamA}-${t.teamB}-${a.name}-${b.name}-${i}`}>
                      <td>
                        <a href={`/team/${t.teamA}`} className="tname">{name(t.teamA)}</a>
                        <span className="tsub block">{a.name} ({a.position})</span>
                      </td>
                      <td>
                        <a href={`/team/${t.teamB}`} className="tname">{name(t.teamB)}</a>
                        <span className="tsub block">{b.name} ({b.position})</span>
                      </td>
                      <td className="num">
                        <span className={`pill ${t.aDelta > 0 ? 'w' : ''}`}>{signed(t.aDelta)}</span>
                      </td>
                      <td className="num">
                        <span className={`pill ${t.bDelta > 0 ? 'w' : ''}`}>{signed(t.bDelta)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">
            Gains are the change in expected weekly <strong>starting</strong> points,
            not player value — a player who improves the roster but cannot crack
            the lineup is worth nothing here. Ranked by the smaller of the two
            gains, so the offer most likely to be accepted leads. The lineup
            behind each number is solved exactly, not greedily.
          </p>
        </div>
      )}
    </>
  );
}
