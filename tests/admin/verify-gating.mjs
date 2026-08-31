#!/usr/bin/env node
/**
 * Verify admin gating by hitting the API routes directly with a real
 * non-admin session -- not by checking that the UI hides a link.
 *
 *   node tests/admin/verify-gating.mjs                  # starts its own server
 *   BASE_URL=http://localhost:3000 node tests/admin/verify-gating.mjs
 *
 * Needs CLERK_SECRET_KEY (read from .env.local) because the only honest way to
 * test a non-admin session is to hold one. A user is created in Clerk, used,
 * and deleted in a finally block.
 *
 * WHAT WOULD MAKE THIS TEST WORTHLESS, and how each is ruled out:
 *
 *   - A dead server returns nothing for every route, so "admin route refused"
 *     would pass trivially. Ruled out by asserting a PUBLIC route returns 200
 *     on the same server in the same run.
 *
 *   - A rejected token makes every authenticated route refuse regardless of
 *     role. Ruled out by asserting the session token is accepted somewhere it
 *     should be -- the token is proven live before it is used to attack.
 *
 *   - A route that is broken for everyone refuses admins too. That control
 *     needs an admin profile, which only the pipeline credential can create;
 *     it runs when PIPELINE_DATABASE_URL is present and reports LOUDLY when it
 *     is not, rather than skipping quietly.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/* ------------------------------------------------------------------ setup */

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const CLERK_SECRET = process.env.CLERK_SECRET_KEY;
if (!CLERK_SECRET) {
  console.error('CLERK_SECRET_KEY is required (put it in .env.local).');
  process.exit(2);
}

const ADMIN_ROUTES = ['/api/admin/allowlist', '/api/admin/pool?season=2026&week=1'];
const PUBLIC_ROUTE = '/standings';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

/**
 * Does this response body contain data only an admin should see?
 *
 * Deliberately specific. A first version of this just looked for "@" and
 * reported a leak on every refusal -- Next's HTML 404 page contains "@clerk"
 * in a chunk filename and "@media" in the inlined CSS. A test that cries wolf
 * on the correct behaviour is worse than no test, because the next real
 * failure gets waved through as another false positive.
 *
 * So: the JSON keys these routes actually return, ESPN's SWID braces format,
 * and an email address with a real TLD.
 */
function leaksAdminData(body) {
  return (
    /"(email|espn_swid|allowlist|is_admin)"\s*:/i.test(body) ||
    /\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/i.test(body) ||
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.(com|net|org|edu|gov|io|us)\b/i.test(body)
  );
}

/* ------------------------------------------------------------ clerk admin */

async function clerk(path, init = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLERK_SECRET}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Clerk ${path} -> ${res.status} ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

/* ----------------------------------------------------------------- server */

async function waitForServer(base, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base, { redirect: 'manual' });
      if (res.status > 0) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

/* ------------------------------------------------------------------- main */

async function main() {
  let base = process.env.BASE_URL;
  let server = null;

  if (!base) {
    const port = 3123;
    base = `http://127.0.0.1:${port}`;

    // Refuse to run against something already on this port. A previous run that
    // failed to clean up left next-server listening, and the following run
    // tested that stale build while printing a full set of passes. Silently
    // testing the wrong binary is the worst outcome available here.
    try {
      await fetch(base, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      throw new Error(
        `something is already listening on ${base}. Refusing to run, because the ` +
        `results would describe that server and not this build. Stop it, or pass ` +
        `BASE_URL to test it deliberately.`
      );
    } catch (e) {
      if (!/already listening/.test(e.message)) {
        // Connection refused is the expected, wanted case: the port is free.
      } else {
        throw e;
      }
    }

    console.log('starting production server...');
    // detached puts the server in its own process group. Without it, killing
    // `npx` leaves the actual next-server holding the port, and the NEXT run
    // silently tests the PREVIOUS build -- which is how a gating change could
    // appear to pass without ever having been loaded.
    server = spawn('npx', ['next', 'start', '-p', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      detached: true,
    });
    server.stdout.on('data', () => {});
    server.stderr.on('data', (d) => process.stderr.write(`  [server] ${d}`));
    if (!(await waitForServer(base))) throw new Error('server never came up');
  }

  let userId = null;
  try {
    // Invite-only mode blocks public registration, but Clerk's Backend API can
    // still create a test user manually. With no row in public.league_allowlist
    // that user gets no profile, so they are exactly the threat this test is
    // about: a legitimately signed-in Clerk user who is not a league admin.
    const email = `gating-test-${Date.now()}@example.com`;
    console.log('creating a non-admin Clerk user (NOT on the LEAGUE allowlist)...');
    const user = await clerk('/users', {
      method: 'POST',
      body: JSON.stringify({
        email_address: [email],
        password: `Tst!${Math.random().toString(36).slice(2)}Aa1`,
        skip_password_checks: true,
      }),
    });
    userId = user.id;

    const session = await clerk('/sessions', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
    const { jwt } = await clerk(`/sessions/${session.id}/tokens`, { method: 'POST' });
    if (!jwt) throw new Error('Clerk returned no session token');
    console.log(`  session ${session.id} for user ${userId}`);

    const authed = (path) =>
      fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${jwt}`, Cookie: `__session=${jwt}` },
        redirect: 'manual',
      });

    // ---- control 1: the server is alive and serving -----------------------
    console.log('\ncontrols (these must pass or the attack results mean nothing):');
    const pub = await fetch(`${base}${PUBLIC_ROUTE}`, { redirect: 'manual' });
    check(pub.status === 200, `public route ${PUBLIC_ROUTE} serves anonymously`,
      `HTTP ${pub.status}`);

    // ---- control 2: the token is real and accepted -------------------------
    const pubAuthed = await authed(PUBLIC_ROUTE);
    check(pubAuthed.status === 200, 'the same session token is accepted on a public route',
      `HTTP ${pubAuthed.status}`);

    // ---- the actual attack -------------------------------------------------
    console.log('\nnon-admin session against the admin API routes:');
    for (const route of ADMIN_ROUTES) {
      const res = await authed(route);
      const body = await res.text();
      check(res.status === 404, `${route} refuses a non-admin`, `HTTP ${res.status}`);
      // A 500 would also be "not 200", but it means the guard crashed rather
      // than refused -- a different bug wearing the same clothes.
      check(res.status !== 500, `${route} refuses cleanly, not by crashing`);
      check(!leaksAdminData(body), `${route} leaks no admin data in the refusal body`);
    }

    console.log('\nunauthenticated against the admin API routes:');
    for (const route of ADMIN_ROUTES) {
      const res = await fetch(`${base}${route}`, { redirect: 'manual' });
      const body = await res.text();
      // Clerk's auth.protect() answers an unauthenticated API call with Next's
      // HTML 404 rather than JSON. Ugly, but correct: it neither confirms the
      // route exists nor returns a body worth reading.
      check(res.status !== 200, `${route} refuses an anonymous caller`, `HTTP ${res.status}`);
      check(!leaksAdminData(body), `${route} leaks nothing anonymously`);
    }

    // ---- positive control: does an ADMIN actually get through? -------------
    console.log('\nadmin positive control:');
    if (!process.env.PIPELINE_DATABASE_URL) {
      console.log('  SKIPPED -- needs PIPELINE_DATABASE_URL to provision an admin profile.');
      console.log('  Without it, a route broken for EVERYONE would look identical to a');
      console.log('  correctly gated one. The database-level equivalent (T30) does run in');
      console.log('  the RLS suite, and proves the policy is not simply `using (false)`.');
    } else {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(process.env.PIPELINE_DATABASE_URL);
      const email = `gating-admin-${Date.now()}@example.com`;
      const adminUser = await clerk('/users', {
        method: 'POST',
        body: JSON.stringify({ email_address: [email] }),
      });
      try {
        await sql.query(
          `insert into public.league_allowlist (email, espn_team_id, season, is_admin)
           values ($1, 1, 2026, true) on conflict (email) do update set is_admin = true`,
          [email]
        );
        await sql.query(`select public.provision_profile($1, $2, 'Gating Test Admin')`,
          [adminUser.id, email]);

        const aSession = await clerk('/sessions', {
          method: 'POST', body: JSON.stringify({ user_id: adminUser.id }),
        });
        const { jwt: aJwt } = await clerk(`/sessions/${aSession.id}/tokens`, { method: 'POST' });

        for (const route of ADMIN_ROUTES) {
          const res = await fetch(`${base}${route}`, {
            headers: { Authorization: `Bearer ${aJwt}`, Cookie: `__session=${aJwt}` },
            redirect: 'manual',
          });
          check(res.status === 200, `${route} SERVES an admin`, `HTTP ${res.status}`);
        }
      } finally {
        await sql.query('delete from public.profiles where id = $1', [adminUser.id]);
        await sql.query('delete from public.league_allowlist where email = $1', [email]);
        await clerk(`/users/${adminUser.id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  } finally {
    if (userId) {
      await clerk(`/users/${userId}`, { method: 'DELETE' }).catch(() => {});
      console.log(`\ncleaned up test user ${userId}`);
    }
    if (server?.pid) {
      // Negative pid = the whole process group, so next-server dies with npx.
      try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  }

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nverification could not run: ${e.message}`);
  console.error('That is NOT a pass -- the gating is unverified.');
  process.exit(2);
});
