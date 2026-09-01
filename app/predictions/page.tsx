import { auth } from '@clerk/nextjs/server';
import {
  getCurrentSeason, getOpenWeek, getWeekMatchups, getMyPicks, getLeaderboard,
  getAllTimeLeaderboard,
} from '../../lib/queries.ts';
import { PickForm } from '../../components/PickForm.tsx';
import { isAdmin } from '../../lib/admin.ts';

// User state -- never cached.
export const dynamic = 'force-dynamic';

/**
 * PICKS LOCK ON SATURDAY -- at the end of Saturday night, US Eastern. The rule
 * itself is enforced in the database: weeks.locks_at is set by
 * public.saturday_lock(), and week_is_locked() gates both the RLS policy and
 * the insert trigger. Nothing here decides it; this only says so out loud.
 */
const LOCK_RULE = 'Picks lock Saturday at midnight ET — the whole of Saturday is yours.';

const easternDateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/New_York', timeZoneName: 'short',
  });

function pct(accuracy: string | null) {
  return accuracy ? `${(Number(accuracy) * 100).toFixed(0)}%` : '—';
}

export default async function Predictions() {
  const { userId } = await auth.protect();
  const season = await getCurrentSeason();
  const open = await getOpenWeek(season);

  const [matchups, picks, board, allTime] = await Promise.all([
    open ? getWeekMatchups(season, open.week) : Promise.resolve([]),
    open ? getMyPicks(season, open.week) : Promise.resolve([]),
    getLeaderboard(season),
    getAllTimeLeaderboard(),
  ]);

  const initial: Record<number, number> = {};
  for (const p of picks) initial[p.espn_matchup_id] = p.predicted_winner_team_id;

  const lockAt = open?.locks_at ?? open?.first_kickoff_at ?? null;
  const locked = lockAt ? new Date(lockAt).getTime() <= Date.now() : true;

  const seasonBy = new Map(board.map((row) => [row.user_id, row]));
  const mine = { season: seasonBy.get(userId), allTime: allTime.find((r) => r.user_id === userId) };

  // Everyone who has ever picked, this season's players first.
  const players = allTime.length > 0 ? allTime : board.map((row) => ({
    user_id: row.user_id, display_name: row.display_name,
    picks_made: 0, correct: 0, points: '0', accuracy: null,
    first_season: season, last_season: season,
  }));

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Call your shot</div>
        <h1>Predictions</h1>
        {open ? (
          <p>
            Week {open.week} · {LOCK_RULE}
            {lockAt && <><br />Closes {easternDateTime(lockAt)}.</>}
          </p>
        ) : (
          <p>No week is open for picks right now. {LOCK_RULE}</p>
        )}
      </div>

      <div className="stat-strip three">
        <div>
          <span>Your {season} record</span>
          <strong>{mine.season ? `${mine.season.correct}-${mine.season.picks_made - mine.season.correct}` : '0-0'}</strong>
        </div>
        <div>
          <span>Your all-time record</span>
          <strong>{mine.allTime ? `${mine.allTime.correct}-${mine.allTime.picks_made - mine.allTime.correct}` : '0-0'}</strong>
        </div>
        <div>
          <span>All-time accuracy</span>
          <strong>{pct(mine.allTime?.accuracy ?? null)}</strong>
        </div>
      </div>

      <h2>Every player</h2>
      <div className="card">
        {players.length === 0 ? (
          <div className="empty">
            No picks have been made yet. Records appear here after the first week
            is scored.
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">{season} record</th>
                  <th className="num">{season} acc.</th>
                  <th className="num">All-time record</th>
                  <th className="num">All-time acc.</th>
                </tr>
              </thead>
              <tbody>
                {players.map((row) => {
                  const s = seasonBy.get(row.user_id);
                  return (
                    <tr key={row.user_id} className={row.user_id === userId ? 'title-row' : undefined}>
                      <td>
                        <span className="tname">{row.display_name ?? 'Someone'}</span>
                        {row.user_id === userId && <span className="tag era">You</span>}
                      </td>
                      <td className="num">
                        {s ? `${s.correct}-${s.picks_made - s.correct}` : '0-0'}
                      </td>
                      <td className="num">{pct(s?.accuracy ?? null)}</td>
                      <td className="num">{row.correct}-{row.picks_made - row.correct}</td>
                      <td className="num">{pct(row.accuracy)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <>
          <h2>Week {open.week}</h2>
          <div className="card">
            {locked ? (
              <p className="note">
                Week {open.week} is locked — picks closed Saturday at midnight ET.
                The database rejects late changes, so nobody can sneak one in.
              </p>
            ) : matchups.length === 0 ? (
              <div className="empty">No matchups scheduled.</div>
            ) : (
              <>
                <p className="note" style={{ marginBottom: 12 }}>
                  Tap a team to pick it to win. Saves immediately, and you can
                  change your mind as often as you like until Saturday midnight ET.
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
        </>
      )}

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
