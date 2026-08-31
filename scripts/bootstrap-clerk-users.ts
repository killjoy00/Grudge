#!/usr/bin/env -S npx tsx

/**
 * Create a Clerk user for every active member on the league roster.
 *
 * This exists to break a bootstrap deadlock. Clerk runs in Invite-only mode, so
 * only an invited address can sign in; invitations are sent from /admin/members,
 * which needs an admin profile; a profile only exists after a successful
 * sign-in. Nobody can get in, and nothing inside the app can fix that.
 *
 * Creating the users directly through Clerk's Backend API skips the invitation
 * email entirely -- the league signs in with an emailed code, as the app is
 * configured for. Idempotent: an address that already has a user is left alone,
 * so re-running after adding a member is safe.
 *
 *   CLERK_SECRET_KEY=sk_... NEON_URL=postgresql://... \
 *     npx tsx scripts/bootstrap-clerk-users.ts --dry-run
 *
 * The key decides which Clerk instance is touched: `sk_test_` is the
 * development instance, `sk_live_` is production. They have separate users, so
 * run this against whichever instance the deployed site's publishable key
 * belongs to.
 */

import { neon } from '@neondatabase/serverless';

const CLERK_API = 'https://api.clerk.com/v1';

const secret = process.env.CLERK_SECRET_KEY;
if (!secret) throw new Error('CLERK_SECRET_KEY is not set.');
const databaseUrl = process.env.NEON_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('NEON_URL (or DATABASE_URL) is not set.');

const dryRun = process.argv.includes('--dry-run');
const skipProvision = process.argv.includes('--no-provision');
const instance = secret.startsWith('sk_live_') ? 'production'
  : secret.startsWith('sk_test_') ? 'development'
    : 'unrecognized';

async function clerk(path: string, init: RequestInit = {}) {
  const response = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.text();
  let parsed: unknown = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { /* non-JSON error body */ }
  if (!response.ok) {
    const detail = (parsed as { errors?: { message?: string; longMessage?: string }[] })?.errors
      ?.map((e) => e.longMessage ?? e.message).filter(Boolean).join('; ');
    throw new Error(`Clerk ${response.status} on ${path}: ${detail || body.slice(0, 200)}`);
  }
  return parsed;
}

interface ClerkUser { id: string; email_addresses?: { email_address: string }[] }

async function findUser(email: string): Promise<ClerkUser | null> {
  const users = await clerk(
    `/users?email_address=${encodeURIComponent(email)}&limit=1`
  ) as ClerkUser[] | { data?: ClerkUser[] };
  const list = Array.isArray(users) ? users : users?.data ?? [];
  return list[0] ?? null;
}

async function createUser(email: string): Promise<ClerkUser> {
  return await clerk('/users', {
    method: 'POST',
    body: JSON.stringify({
      email_address: [email],
      // The league signs in passwordless, by emailed code. Without these Clerk
      // rejects a user created with no password.
      skip_password_requirement: true,
      skip_password_checks: true,
    }),
  }) as ClerkUser;
}

const sql = neon(databaseUrl.trim());

const roster = await (sql as unknown as {
  query: (text: string, params: unknown[]) => Promise<{ email: string; is_admin: boolean }[]>;
}).query(
  `select email::text as email, is_admin
     from public.league_allowlist
    where is_active
    order by is_admin desc, email`,
  []
);

console.log(
  `Clerk instance: ${instance} (${secret.slice(0, 8)}…)\n` +
  `Roster: ${roster.length} active members\n`
);

let created = 0;
let existing = 0;
let provisioned = 0;
const failures: string[] = [];

for (const member of roster) {
  const label = `${member.email}${member.is_admin ? ' (admin)' : ''}`;
  try {
    let user = await findUser(member.email);
    if (user) {
      existing++;
      console.log(`  = ${label} — already has a Clerk user`);
    } else if (dryRun) {
      created++;
      console.log(`  + ${label} — would create`);
      continue;
    } else {
      user = await createUser(member.email);
      created++;
      console.log(`  + ${label} — created ${user.id}`);
    }

    // The user.created webhook normally writes this row. Doing it here too
    // means a webhook pointed at the wrong instance cannot leave someone
    // signed in with no league profile.
    if (!dryRun && !skipProvision && user) {
      await (sql as unknown as {
        query: (text: string, params: unknown[]) => Promise<unknown>;
      }).query('select public.provision_profile($1, $2::citext, $3)', [user.id, member.email, null]);
      provisioned++;
    }
  } catch (error) {
    failures.push(`${member.email}: ${(error as Error).message}`);
    console.error(`  ! ${label} — ${(error as Error).message}`);
  }
}

console.log(
  `\n${dryRun ? 'Dry run. ' : ''}` +
  `${created} created, ${existing} already present` +
  (skipProvision || dryRun ? '' : `, ${provisioned} profiles provisioned`) +
  (failures.length ? `, ${failures.length} failed` : '') + '.'
);
if (failures.length) process.exit(1);
