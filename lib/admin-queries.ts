import 'server-only';

/**
 * Admin-only reads.
 *
 * Every function here goes through asUser(), so the caller's identity is set
 * for the transaction and the `using (public.is_admin())` policies on
 * league_allowlist and player_ownership_snapshots decide what comes back. A
 * non-admin reaching any of these gets an empty array, not an error and not
 * someone else's data.
 *
 * That is the actual guarantee. The requireAdminApi() check on the routes is a
 * second layer that produces a clean 404 -- it is not what keeps the data safe.
 */
import { asUser } from './db.ts';

/**
 * ESPN position ids.
 *
 * Derived in Step 1 by inverting `eligibleSlots` across 185 real players, not
 * taken from a blog post. Anything unmapped renders as its raw id so a new
 * position shows up as "pos 7" rather than silently becoming "unknown".
 */
export const POSITION_SQL = `
  case p.default_position_id
    when 1 then 'QB' when 2 then 'RB' when 3 then 'WR' when 4 then 'TE'
    when 5 then 'K'  when 16 then 'D/ST'
    else 'pos ' || coalesce(p.default_position_id::text, '?')
  end`;

export interface PoolPlayer {
  espn_player_id: number;
  full_name: string;
  position: string;
  percent_owned: string | null;
  percent_started: string | null;
  espn_percent_change: string | null;
  our_percent_change: string | null;
  auction_value_avg: string | null;
  status: string | null;
  week: number;
}

/**
 * The free-agent pool for a week, with BOTH trend measures side by side.
 *
 * `espn_percent_change` is ESPN's own week-over-week number, captured in the
 * same row. `our_percent_change` is computed from the previous snapshot we
 * took. They answer the same question from independent data, so when they
 * disagree the snapshot cadence is wrong -- which is a failure that would
 * otherwise look like a plausible trend.
 *
 * our_percent_change is null in the first week of capture, because there is
 * genuinely no prior observation. It is not zero: no data and no movement are
 * different facts.
 */
export async function getPool(season: number, week: number, limit = 100) {
  const [rows] = await asUser<PoolPlayer>((q) => [
    q(
      `with series as (
         select s.espn_player_id, s.week, s.percent_owned, s.percent_started,
                s.percent_change, s.auction_value_avg, s.status,
                lag(s.percent_owned) over (
                  partition by s.espn_player_id order by s.week
                ) as prev_owned
           from public.player_ownership_snapshots s
          where s.season = $1 and s.week <= $2
       )
       select se.espn_player_id,
              p.full_name,
              ${POSITION_SQL} as position,
              se.percent_owned,
              se.percent_started,
              se.percent_change              as espn_percent_change,
              case when se.prev_owned is null then null
                   else round(se.percent_owned - se.prev_owned, 2)
              end                            as our_percent_change,
              se.auction_value_avg,
              se.status,
              se.week
         from series se
         join public.players p on p.espn_player_id = se.espn_player_id
        where se.week = $2
        order by se.percent_owned desc nulls last
        limit $3`,
      [season, week, limit]
    ),
  ]);
  return rows ?? [];
}

/**
 * Players the wider ESPN population owns but who are still free in this league.
 *
 * This is the only genuinely actionable thing in the pool data. A high
 * percent_owned means the rest of ESPN rates the player; still sitting on our
 * waiver wire means nobody here has noticed yet. The gap is the opportunity.
 *
 * Deliberately NOT ranked by projected points. Projections are what everyone
 * already sees in the ESPN UI, so ranking by them surfaces nothing the league
 * does not know; the ownership gap is information the UI does not show.
 */
export async function getPoolOpportunities(season: number, week: number, limit = 25) {
  const [rows] = await asUser<PoolPlayer & { trend: string | null }>((q) => [
    q(
      `select s.espn_player_id,
              p.full_name,
              ${POSITION_SQL} as position,
              s.percent_owned,
              s.percent_started,
              s.percent_change as espn_percent_change,
              null::numeric    as our_percent_change,
              s.auction_value_avg,
              s.status,
              s.week,
              case when s.percent_change > 1 then 'rising'
                   when s.percent_change < -1 then 'falling'
                   else 'flat' end as trend
         from public.player_ownership_snapshots s
         join public.players p on p.espn_player_id = s.espn_player_id
        where s.season = $1 and s.week = $2
          and s.on_team_id = 0
          and s.percent_owned is not null
        order by s.percent_owned desc
        limit $3`,
      [season, week, limit]
    ),
  ]);
  return rows ?? [];
}

/** Which weeks we actually hold snapshots for -- the honest coverage report. */
export async function getSnapshotCoverage(season: number) {
  const [rows] = await asUser<{ week: number; players: number; captured_at: string }>((q) => [
    q(
      `select week, count(*)::int as players, max(captured_at) as captured_at
         from public.player_ownership_snapshots
        where season = $1
        group by week
        order by week desc`,
      [season]
    ),
  ]);
  return rows ?? [];
}

/** The league allowlist. Admin-only by RLS policy, not just by this module. */
export async function getAllowlist() {
  const [rows] = await asUser<{
    email: string; espn_team_id: number | null; is_admin: boolean; espn_swid: string | null;
  }>((q) => [
    q(
      `select email::text as email, espn_team_id, is_admin, espn_swid
         from public.league_allowlist
        order by is_admin desc, email`
    ),
  ]);
  return rows ?? [];
}

/** Who has actually signed in and claimed a team. */
export async function getProvisionedMembers() {
  const [rows] = await asUser<{
    id: string; email: string; display_name: string | null;
    espn_team_id: number | null; is_admin: boolean; team_name: string | null;
  }>((q) => [
    q(
      `select pr.id, pr.email::text as email, pr.display_name, pr.espn_team_id, pr.is_admin,
              t.name as team_name
         from public.profiles pr
         left join public.teams t
           on t.espn_team_id = pr.espn_team_id
          and t.season = (select max(season) from public.teams)
        order by pr.is_admin desc, pr.email`
    ),
  ]);
  return rows ?? [];
}
