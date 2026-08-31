import 'server-only';

/**
 * Admin authorization.
 *
 * THE RULE: admin status is read from the database, per request, as the
 * signed-in user. It is never taken from a Clerk claim, a cookie, a header, a
 * query parameter, or anything else the caller can influence.
 *
 * The active league_allowlist row is the source of truth. public.is_admin()
 * joins it to the signed-in profile inside a SECURITY DEFINER function, so a
 * demotion takes effect even if the profile's denormalized flag has not yet
 * refreshed. Browser sessions cannot modify privileged profile columns.
 *
 * DEFENCE IN DEPTH, and why this file is not load-bearing on its own: every
 * admin-only table also carries an RLS policy of `using (public.is_admin())`.
 * If every check in this file were deleted, a non-admin hitting an admin route
 * would get an empty result rather than someone else's data. That ordering is
 * deliberate. Route guards are the thing that drifts when someone adds a page
 * in a hurry; the database policy is the thing that holds.
 *
 * So this file exists to produce a correct 404 instead of a confusing empty
 * page -- not to be the thing standing between a member and the allowlist.
 */
import { auth } from '@clerk/nextjs/server';
import { asUser } from './db.ts';

export interface AdminProfile {
  id: string;
  display_name: string | null;
  espn_team_id: number | null;
  is_admin: boolean;
}

/**
 * The signed-in user's profile if they are an admin, otherwise null.
 *
 * Returns null rather than throwing for the two non-exceptional cases -- not
 * signed in, and signed in but not an admin -- so callers can decide between
 * a redirect and a 404 without a try/catch.
 */
export async function adminProfile(): Promise<AdminProfile | null> {
  const { userId } = await auth();
  if (!userId) return null;

  try {
    const [rows] = await asUser<AdminProfile>((q) => [
      q(
        `select id, display_name, espn_team_id, true as is_admin
           from public.profiles
          where id = $1 and public.is_admin()`,
        [userId]
      ),
    ]);
    return rows?.[0] ?? null;
  } catch {
    // A database error must not read as "authorized". Fail closed.
    return null;
  }
}

/** Cheap boolean form, for deciding whether to render an admin nav link. */
export async function isAdmin(): Promise<boolean> {
  return (await adminProfile()) !== null;
}

/**
 * Guard for admin API routes. Returns the profile, or a Response to return
 * as-is.
 *
 * Both refusals are 404, not 403. A 403 confirms the route exists and that
 * the caller simply lacks the role, which tells an unprivileged member exactly
 * what to go looking for. A 404 tells them nothing.
 */
export async function requireAdminApi(): Promise<
  { ok: true; profile: AdminProfile } | { ok: false; response: Response }
> {
  const profile = await adminProfile();
  if (!profile) {
    return {
      ok: false,
      response: Response.json({ error: 'Not found' }, { status: 404 }),
    };
  }
  return { ok: true, profile };
}
