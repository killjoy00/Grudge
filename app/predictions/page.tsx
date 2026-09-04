import { auth } from '@clerk/nextjs/server';
import {
  getCurrentSeason, getOpenWeek, getWeekMatchups, getMyPicks, getLeaderboard,
  getAllTimeLeaderboard, getWeekProjections, getEspnRecord, getTeamStars,
} from '../../lib/queries.ts';
import { PickForm } from '../../components/PickForm.tsx';
import type { Projection, Star } from '../../components/PickForm.tsx';
import { POSITIONS } from '../../pipeline/trade.ts';
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

interface PickRecord { correct: number; incorrect: number; pushed: number }

/**
 * A pick record, from the counts rather than by subtraction.
 *
 * This used to read `correct - (picks_made - correct)`, which treated every
 * pick you had made but not yet played as a loss. Ties are shown only when
 * there are any, because "4-3-0" invites a question nobody has.
 */
function record(r: PickRecord | undefined) {
  if (!r) return '0-0';
  return r.pushed > 0
    ? `${r.correct}-${r.incorrect}-${r.pushed}`
    : `${r.correct}-${r.incorrect}`;
}

export default async function Predictions() {
  const { userId } = await auth.protect();
  const season = await getCurrentSeason();
  const open = await getOpenWeek(season);

  const [matchups, picks, board, allTime, projRows, starRows, espn] = await Promise.all([
    open ? getWeekMatchups(season, open.week) : Promise.resolve([]),
    open ? getMyPicks(season, open.week) : Promise.resolve([]),
    getLeaderboard(season),
    getAllTimeLeaderboard(),
    open ? getWeekProjections(season, open.week) : Promise.resolve([]),
    open ? getTeamStars(season, open.week) : Promise.resolve([]),
    getEspnRecord(season),
  ]);

  const initial: Record<number, number> = {};
  for (const p of picks) initial[p.espn_matchup_id] = p.predicted_winner_team_id;

  // ESPN's projection, keyed by matchup. Both sides are required: one side
  // alone is not a comparison, and rendering it would invite the reader to
  // treat a lone number as a verdict.
  const projections: Record<number, Projection> = {};
  const byMatchup = new Map<number, typeof projRows>();
  for (const row of projRows) {
    byMatchup.set(row.espn_matchup_id, [...(byMatchup.get(row.espn_matchup_id) ?? []), row]);
  }
  for (const m of matchups) {
    const sides = byMatchup.get(m.espn_matchup_id) ?? [];
    const home = sides.find((s) => s.espn_team_id === m.home_team_id);
    const away = sides.find((s) => s.espn_team_id === m.away_team_id);
    if (!home || !away) continue;
    projections[m.espn_matchup_id] = {
      home: Number(home.projected_points),
      away: Number(away.projected_points),
      capturedAt: home.captured_at,
    };
  }

  const stars: Record<number, Star[]> = {};
  for (const row of starRows) {
    (stars[row.espn_team_id] ??= []).push({
      espn_player_id: row.espn_player_id,
      full_name: row.full_name,
      position: POSITIONS[row.default_position_id ?? 0] ?? '—',
      detail: row.detail,
    });
  }
  const starBasis = starRows[0]?.basis ?? null;

  const lockAt = open?.locks_at ?? open?.first_kickoff_at ?? null;
  const locked = lockAt ? new Date(lockAt).getTime() <= Date.now() : true;

  const seasonBy = new Map(board.map((row) => [row.user_id, row]));
  const mine = { season: seasonBy.get(userId), allTime: allTime.find((r) => r.user_id === userId) };

  // Everyone who has ever picked, this season's players first.
  const players = allTime.length > 0 ? allTime : board.map((row) => ({
    user_id: row.user_id, display_name: row.display_name,
    picks_made: 0, decided: 0, correct: 0, incorrect: 0, pushed: 0, pending: 0,
    points: '0', accuracy: null,
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
          <strong>{record(mine.season)}</strong>
          {mine.season && mine.season.pending > 0 && (
            <small className="block note">{mine.season.pending} awaiting kickoff</small>
          )}
        </div>
        <div>
          <span>Your all-time record</span>
          <strong>{record(mine.allTime)}</strong>
        </div>
        <div>
          <span>All-time accuracy</span>
          <strong>{pct(mine.allTime?.accuracy ?? null)}</strong>
        </div>
      </div>

      {open && (
        <>
          <h2>Week {open.week}</h2>
          <div className="card">
            {matchups.length === 0 ? (
              <div className="empty">No matchups scheduled.</div>
            ) : (
              <>
                <p className="note" style={{ marginBottom: 12 }}>
                  {locked ? (
                    <>
                      Week {open.week} is locked — picks closed Saturday at midnight
                      ET, and the database rejects late changes. Your picks are shown
                      below; the ESPN link on each matchup follows it live.
                    </>
                  ) : (
                    <>
                      Tap a team to pick it to win. Saves immediately, and you can
                      change your mind as often as you like until Saturday midnight ET.
                    </>
                  )}
                </p>
                {/* Rendered even when locked. The board used to be replaced by a
                    bare note the moment picks closed, which hid the matchups for
                    the whole weekend -- exactly when people want to see what they
                    picked and follow the games. The buttons disable themselves,
                    and a late write is refused by the database regardless. */}
                {starBasis && (
                  <p className="note" style={{ marginBottom: 12 }}>
                    {starBasis === 'draft'
                      ? 'Under each team, its earliest draft picks — nobody has scored ' +
                        'anything yet, so what a manager spent their first picks on is ' +
                        'the best guide to who they are counting on.'
                      : 'Under each team, its highest scorers so far this season, ' +
                        'counting only points put up in the starting lineup.'}
                  </p>
                )}
                <PickForm
                  season={season}
                  week={open.week}
                  matchups={matchups}
                  initial={initial}
                  locked={locked}
                  projections={projections}
                  stars={stars}
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
      <h2>Every manager</h2>
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
                  <th>Manager</th>
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
                        {record(s)}
                      </td>
                      <td className="num">{pct(s?.accuracy ?? null)}</td>
                      <td className="num">{record(row)}</td>
                      <td className="num">{pct(row.accuracy)}</td>
                    </tr>
                  );
                })}
                {/* ESPN, as the house line to beat.
                    Not a member and not a row in `predictions` -- its pick is
                    derived from the projection it published, so it cannot be
                    edited, cannot see anyone else's picks, and cannot drift
                    from the number the matchup box showed. All-time is left
                    blank rather than backfilled: projections were only
                    captured from the week this shipped, and a record covering
                    a different set of games is not a comparison. */}
                {espn && (
                  <tr className="espn-row">
                    <td>
                      <span className="tname">ESPN projections</span>
                      <span className="tag era">Not a manager</span>
                    </td>
                    <td className="num">{record(espn)}</td>
                    <td className="num">{pct(espn.accuracy)}</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {espn && (
          <p className="note" style={{ marginTop: 10 }}>
            ESPN&rsquo;s pick is whichever side its Tuesday projection put ahead. It is
            captured before the games and never revised, so beating it means beating
            the number you were shown, not one written afterwards.
          </p>
        )}
      </div>

    </>
  );
}
