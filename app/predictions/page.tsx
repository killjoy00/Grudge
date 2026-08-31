import { auth } from '@clerk/nextjs/server';
import {
  getCurrentSeason, getOpenWeek, getWeekResults, getMyPicks, getLeaderboard,
} from '../../lib/queries.ts';
import { PickForm } from '../../components/PickForm.tsx';
import { isAdmin } from '../../lib/admin.ts';

// User state -- never cached.
export const dynamic = 'force-dynamic';

export default async function Predictions() {
  const { userId } = await auth.protect();
  const season = await getCurrentSeason();
  const open = await getOpenWeek(season);

  const [matchups, picks, board] = await Promise.all([
    open ? getWeekResults(season, open.week) : Promise.resolve([]),
    open ? getMyPicks(season, open.week) : Promise.resolve([]),
    getLeaderboard(season),
  ]);

  const initial: Record<number, number> = {};
  for (const p of picks) initial[p.espn_matchup_id] = p.predicted_winner_team_id;

  const lockAt = open?.locks_at ?? open?.first_kickoff_at ?? null;
  const locked = lockAt ? new Date(lockAt).getTime() <= Date.now() : true;

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Call your shot</div>
        <h1>Predictions</h1>
        {open ? (
          <p>
          Week {open.week} · picks lock at first kickoff
          {lockAt && ` — ${new Date(lockAt).toLocaleString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
            timeZone: 'America/New_York', timeZoneName: 'short',
          })}`}
          </p>
        ) : (
          <p>No week is open for picks right now.</p>
        )}
      </div>

      {open && (
        <div className="card">
          {locked ? (
            <p className="note">
              Week {open.week} is locked. Picks closed at kickoff — the database
              rejects late changes, so nobody can sneak one in.
            </p>
          ) : matchups.length === 0 ? (
            <div className="empty">No matchups scheduled.</div>
          ) : (
            <>
              <p className="note" style={{ marginBottom: 12 }}>
                Tap a team to pick it. Saves immediately. Change your mind as often as
                you like until kickoff.
              </p>
              <PickForm
                season={season}
                week={open.week}
                matchups={matchups}
                initial={initial}
                locked={locked}
              />
            </>
          )}
        </div>
      )}

      <h2>Season leaderboard</h2>
      <div className="card">
        {board.length === 0 ? (
          <div className="empty">
            Nothing scored yet — the Tuesday pipeline fills this in.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="rank">#</th><th>Player</th>
                <th className="num">Correct</th><th className="num">Picks</th><th className="num">Acc.</th>
              </tr>
            </thead>
            <tbody>
              {board.map((r, i) => (
                <tr key={r.user_id}>
                  <td className="rank">{i + 1}</td>
                  <td className="tname">{r.display_name ?? 'Someone'}</td>
                  <td className="num">{r.correct}</td>
                  <td className="num">{r.picks_made}</td>
                  <td className="num">{r.accuracy ? `${(Number(r.accuracy) * 100).toFixed(0)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* The only entry point to /admin. It is kept off the global nav because
          resolving admin status in the root layout would make every page on the
          site render per request. Hiding the link is presentation only -- the
          route is guarded server-side and the tables are guarded by RLS. */}
      {(await isAdmin()) && (
        <p className="note" style={{ textAlign: 'center' }}>
          <a href="/admin">League admin →</a>
        </p>
      )}
    </>
  );
}
