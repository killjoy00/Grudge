/**
 * The league allowlist as JSON.
 *
 * This is the most sensitive endpoint in the app: it returns every member's
 * email address and SWID. It exists as a route rather than only as a page
 * because the admin view filters it client-side, and because an endpoint that
 * returns real secrets is the right thing to point an authorization test at.
 *
 * Three independent things have to fail before a non-admin sees this: the
 * middleware matcher, requireAdminApi(), and the allowlist_admin_read RLS
 * policy. The last one is the one that actually holds -- it is enforced by
 * Postgres against a connection with no BYPASSRLS.
 */
import { requireAdminApi } from '../../../../lib/admin.ts';
import { getAllowlist, getProvisionedMembers } from '../../../../lib/admin-queries.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const [allowlist, members] = await Promise.all([getAllowlist(), getProvisionedMembers()]);

  // Who is on the list but has never signed in -- the question an admin
  // actually has when someone says "I can't get in".
  const claimed = new Set(members.map((m) => m.email.toLowerCase()));
  const pending = allowlist.filter((a) => !claimed.has(a.email.toLowerCase()));

  return Response.json({ allowlist, members, pending });
}
