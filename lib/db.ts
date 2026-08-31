import 'server-only';

/**
 * Database access for the web app.
 *
 * SECURITY MODEL — the single most important file in the app.
 *
 * Two connections, used for different things and never confused:
 *
 *   asUser()   connects as `app_user` (NO bypassrls) and sets
 *              `app.user_id` for the transaction after verifying the Clerk
 *              session server-side. Every RLS policy then applies. This is the
 *              only path used for anything a signed-in member does.
 *
 *   asPublic() connects as the same non-privileged role with NO identity set.
 *              app.current_user_id() returns null, so policies match nothing
 *              user-owned and only the public mirror tables are readable.
 *              Used for the static pages.
 *
 * There is deliberately NO connection here as `app_pipeline` (the BYPASSRLS
 * role). The web app must never be able to bypass a policy; that role belongs
 * to the pipeline and lives only in CI secrets.
 *
 * `SET LOCAL` scopes the identity to the transaction, so a pooled connection
 * cannot carry one request's user into the next. Tests T25/T26 in
 * tests/rls/02-attacks.sql cover exactly that.
 */
import { neon } from '@neondatabase/serverless';
import { auth } from '@clerk/nextjs/server';

const url = process.env.APP_DATABASE_URL;
if (!url && process.env.NODE_ENV === 'production') {
  throw new Error('APP_DATABASE_URL is not set');
}

const sql = neon(url ?? '');

type Row = Record<string, unknown>;

/**
 * Run queries as the signed-in user, inside one transaction that carries their
 * identity. Throws if there is no Clerk session -- callers must not be able to
 * accidentally run "as nobody" and get a confusing empty result instead of an
 * auth error.
 */
export async function asUser<T = Row>(
  build: (q: (text: string, params?: unknown[]) => unknown) => unknown[]
): Promise<T[][]> {
  const { userId } = await auth();
  if (!userId) throw new Error('not signed in');

  const q = (text: string, params: unknown[] = []) =>
    (sql as unknown as { query: (t: string, p: unknown[]) => unknown }).query(text, params);

  const batch = [
    // set_config(..., true) is SET LOCAL: transaction-scoped, so it cannot
    // leak across pooled requests.
    q('select set_config($1, $2, true)', ['app.user_id', userId]),
    ...build(q),
  ];
  const results = (await (sql as unknown as {
    transaction: (b: unknown[]) => Promise<unknown>;
  }).transaction(batch)) as T[][];
  return results.slice(1); // drop the set_config result
}

/** Read-only queries with no identity. Only public data is reachable. */
export async function asPublic<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const rows = await (sql as unknown as {
    query: (t: string, p: unknown[]) => Promise<T[]>;
  }).query(text, params);
  return rows;
}

/** The signed-in member's profile, or null. */
export async function currentProfile() {
  const { userId } = await auth();
  if (!userId) return null;
  const [rows] = await asUser<{
    id: string; display_name: string | null; espn_team_id: number | null; is_admin: boolean;
  }>((q) => [
    q('select id, display_name, espn_team_id, is_admin from public.profiles where id = $1', [userId]),
  ]);
  return rows?.[0] ?? null;
}
