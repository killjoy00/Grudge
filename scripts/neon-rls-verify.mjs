#!/usr/bin/env node
/**
 * Verify the RLS security model against the REAL Neon database.
 *
 * The local suite in tests/rls/ proves the policy LOGIC using a stubbed
 * auth.user_id(). This proves the same policies work against the actual
 * pg_session_jwt extension, with a genuinely signed JWT -- i.e. that the
 * deployed database enforces what the design claims.
 *
 * How it fakes being Clerk: pg_session_jwt validates the session JWT against
 * whatever JWK sits in the `pg_session_jwt.jwk` GUC. We generate our own
 * Ed25519 keypair, install its public half as that JWK for the session, and
 * sign our own tokens. Clerk would supply a real JWKS in production; the
 * verification path exercised here is identical.
 *
 *   NEON_URL=... node scripts/neon-rls-verify.mjs
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const CONN = process.env.NEON_URL;
if (!CONN) { console.error('NEON_URL required'); process.exit(1); }
const ENDPOINT = `https://${new URL(CONN.replace(/^postgresql:/, 'https:')).host}/sql`;

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/* ---- generate a keypair and the matching public JWK ---- */
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPub = publicKey.export({ format: 'jwk' });
const jwk = { kty: 'OKP', crv: 'Ed25519', x: rawPub.x, kid: 'test-key-1', alg: 'EdDSA', use: 'sig' };

function makeJwt(sub) {
  const header = { alg: 'EdDSA', typ: 'JWT', kid: 'test-key-1' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub, iat: now, exp: now + 3600, jti: `test-${now}-${sub}` };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = cryptoSign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64u(sig)}`;
}

/** Run several statements in ONE session so SET/SET ROLE persist across them. */
async function batch(queries) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Neon-Connection-String': CONN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: queries.map((q) => ({ query: q, params: [] })) }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

/** Session preamble: install the JWK, attach a signed token, become `authenticated`. */
function asUser(sub, ...statements) {
  return [
    `set local pg_session_jwt.jwk = '${JSON.stringify(jwk)}'`,
    `select auth.jwt_session_init('${makeJwt(sub)}')`,
    `set local role authenticated`,
    ...statements,
  ];
}

const results = [];
function check(label, passed, detail) {
  results.push({ label, passed, detail });
  const tag = passed ? '\x1b[32mpass\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${tag}  ${label}${detail ? `\n          ${detail}` : ''}`);
}

/** The last query's rows, for a batch expected to succeed. */
function lastRows(r) {
  if (!r.ok) return null;
  const arr = Array.isArray(r.json) ? r.json : r.json?.results;
  if (!arr) return null;
  return arr[arr.length - 1]?.rows ?? null;
}
function errMsg(r) {
  return r.json?.message ?? r.text?.slice(0, 200) ?? 'unknown';
}

const OWNER = 'user_test_owner_0001';
const ADMIN = 'user_test_admin_0001';

console.log('\nVerifying RLS against the live Neon database\n');

/* ---------- 0. the core question: does auth.user_id() resolve our JWT? ---------- */
{
  const r = await batch(asUser(OWNER, `select auth.user_id() as uid`));
  const rows = lastRows(r);
  const got = rows?.[0]?.uid;
  check('auth.user_id() returns the JWT subject',
    got === OWNER,
    got === OWNER ? `-> ${got}` : `expected ${OWNER}, got ${JSON.stringify(got) ?? errMsg(r)}`);
  if (got !== OWNER) {
    console.log('\nCannot continue without a working JWT session.\n');
    process.exit(1);
  }
}

/* ---------- 1. seed fixtures as the owner (bypasses RLS) ---------- */
{
  const r = await batch([
    `insert into public.seasons (season, league_name, team_count, regular_season_weeks,
        playoff_team_count, final_scoring_period, faab_budget, is_current, settings_raw)
      values (2026,'UNC Grudge Match',10,14,6,17,100,true,'{}')
      on conflict (season) do nothing`,
    `insert into public.teams (season, espn_team_id, name) values
        (2026,1,'Austin Bubbs'),(2026,6,'P RIVERS NAS NAS'),(2026,11,'Taco MacArthur')
      on conflict do nothing`,
    `insert into public.weeks (season, week, first_kickoff_at, locks_at, status) values
        (2026,1, now() + interval '3 days', now() + interval '3 days','upcoming'),
        (2026,2, now() - interval '3 days', now() - interval '3 days','final')
      on conflict do nothing`,
    `insert into public.matchups (season, espn_matchup_id, week, home_team_id, away_team_id)
      values (2026,1,1,6,1),(2026,2,1,11,1),(2026,11,2,1,6) on conflict do nothing`,
    `insert into public.league_allowlist (email, espn_team_id, season, is_admin) values
        ('owner@example.com',1,2026,false),('boss@example.com',6,2026,true)
      on conflict (email) do nothing`,
    `select public.provision_profile('${OWNER}','owner@example.com','Ryan')`,
    `select public.provision_profile('${ADMIN}','boss@example.com','Jordan')`,
  ]);
  check('fixtures + provision_profile() seed cleanly', r.ok, r.ok ? null : errMsg(r));
  if (!r.ok) process.exit(1);
}

/* ---------- 2. the allowlist gate ---------- */
{
  const r = await batch([
    `select public.provision_profile('user_stranger','stranger@evil.com','Nobody')`,
  ]);
  check('ATTACK provision a NON-allowlisted email is refused',
    !r.ok && /not on the league allowlist/i.test(errMsg(r)), r.ok ? 'unexpectedly succeeded' : null);
}

/* ---------- 3. privilege escalation ---------- */
{
  const r = await batch(asUser(OWNER,
    `update public.profiles set is_admin = true where id = auth.user_id()`));
  check('ATTACK self-elevate to admin is blocked',
    !r.ok, r.ok ? 'unexpectedly succeeded' : `(${errMsg(r).slice(0, 60)})`);
}
{
  const r = await batch(asUser(OWNER,
    `update public.profiles set display_name = 'Ryan M.' where id = auth.user_id()`,
    `select display_name from public.profiles where id = auth.user_id()`));
  const name = lastRows(r)?.[0]?.display_name;
  check('legitimate display_name change works', name === 'Ryan M.',
    name === 'Ryan M.' ? null : `got ${JSON.stringify(name) ?? errMsg(r)}`);
}
{
  const r = await batch(asUser(OWNER,
    `update public.profiles set display_name = 'pwned' where id = '${ADMIN}'`,
    `select display_name from public.profiles where id = '${ADMIN}'`));
  const name = lastRows(r)?.[0]?.display_name;
  check("ATTACK edit another user's profile affects nothing", name === 'Jordan',
    name === 'Jordan' ? null : `admin display_name is now ${JSON.stringify(name)}`);
}

/* ---------- 4. the allowlist is admin-only ---------- */
{
  const r = await batch(asUser(OWNER, `select count(*)::int as n from public.league_allowlist`));
  const n = lastRows(r)?.[0]?.n;
  check('ATTACK read allowlist as non-admin returns 0 rows', n === 0,
    n === 0 ? null : `saw ${n} rows`);
}
{
  const r = await batch(asUser(ADMIN, `select count(*)::int as n from public.league_allowlist`));
  const n = lastRows(r)?.[0]?.n;
  check('admin CAN read the allowlist', n === 2, n === 2 ? null : `saw ${n}, expected 2`);
}

/* ---------- 5. THE headline requirement: the prediction lock ---------- */
{
  const r = await batch(asUser(OWNER,
    `insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
     values (auth.user_id(),2026,1,1,6)`));
  check('pick in an OPEN week is allowed', r.ok, r.ok ? null : errMsg(r));
}
{
  const r = await batch(asUser(OWNER,
    `insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
     values (auth.user_id(),2026,2,11,1)`));
  check('ATTACK pick in a LOCKED week is refused',
    !r.ok && /is locked/i.test(errMsg(r)), r.ok ? 'unexpectedly succeeded' : null);
}
{
  const r = await batch(asUser(OWNER,
    `insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
     values (auth.user_id(),2026,99,1,6)`));
  check('ATTACK unknown week fails CLOSED',
    !r.ok, r.ok ? 'unexpectedly succeeded' : null);
}
{
  const r = await batch(asUser(OWNER,
    `insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
     values (auth.user_id(),2026,1,2,6)`));
  check('ATTACK pick a team not in the matchup is refused',
    !r.ok && /not in matchup/i.test(errMsg(r)), r.ok ? 'unexpectedly succeeded' : null);
}
{
  const r = await batch(asUser(OWNER,
    `insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
     values ('${ADMIN}',2026,1,2,11)`));
  check("ATTACK submit a pick as another user is refused",
    !r.ok, r.ok ? 'unexpectedly succeeded' : null);
}
{
  const r = await batch(asUser(OWNER,
    `insert into public.prediction_scores (prediction_id,is_correct,points)
     select id,true,100 from public.predictions where user_id = auth.user_id() limit 1`));
  check('ATTACK award yourself prediction points is refused',
    !r.ok, r.ok ? 'unexpectedly succeeded' : null);
}

/* ---------- 6. pick secrecy before lock ---------- */
{
  await batch([
    `insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
     values ('${ADMIN}',2026,1,1,1) on conflict do nothing`,
  ]);
  const r = await batch(asUser(OWNER,
    `select count(*)::int as n from public.predictions where week = 1`));
  const n = lastRows(r)?.[0]?.n;
  check("pick secrecy: rival's OPEN-week pick is hidden", n === 1,
    n === 1 ? null : `saw ${n} week-1 picks, expected only own`);
}

/* ---------- summary ---------- */
const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against live Neon\n`);
process.exit(failed ? 1 : 0);
