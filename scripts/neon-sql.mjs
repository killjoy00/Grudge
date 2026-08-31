#!/usr/bin/env node
/**
 * Run SQL against Neon over its HTTPS /sql endpoint.
 *
 * Why this exists rather than just using psql: this sandbox blocks outbound
 * TCP 5432, so the normal Postgres wire protocol can't be used from here.
 * Neon also exposes an HTTP endpoint (what @neondatabase/serverless talks to),
 * which works fine through an HTTPS-only egress path.
 *
 * The endpoint takes ONE statement per request, so this splits a script into
 * statements first. The splitter is dollar-quote aware ($$ ... $$ and
 * $tag$ ... $tag$), which matters because every plpgsql function body in our
 * schema is dollar-quoted and naively splitting on ';' would shred them.
 *
 *   node scripts/neon-sql.mjs file.sql        # run a script
 *   node scripts/neon-sql.mjs -c "select 1"   # run one statement
 *   NEON_URL=... node scripts/neon-sql.mjs ...
 */
import { readFileSync } from 'node:fs';

const CONN = process.env.NEON_URL;
if (!CONN) {
  console.error('NEON_URL must be set to the Neon connection string.');
  process.exit(1);
}
const HOST = new URL(CONN.replace(/^postgresql:/, 'https:')).host;
const ENDPOINT = `https://${HOST}/sql`;

/** Split a SQL script into statements, respecting dollar-quoting and comments. */
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  while (i < sql.length) {
    const ch = sql[i];
    const rest = sql.slice(i);

    if (inLineComment) {
      buf += ch;
      if (ch === '\n') inLineComment = false;
      i++; continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (rest.startsWith('*/')) { buf += '/'; i += 2; inBlockComment = false; continue; }
      i++; continue;
    }
    if (dollarTag) {
      if (rest.startsWith(dollarTag)) { buf += dollarTag; i += dollarTag.length; dollarTag = null; continue; }
      buf += ch; i++; continue;
    }
    if (inSingle) {
      buf += ch;
      if (ch === "'") inSingle = false;
      i++; continue;
    }
    if (rest.startsWith('--')) { buf += ch; inLineComment = true; i++; continue; }
    if (rest.startsWith('/*')) { buf += ch; inBlockComment = true; i++; continue; }
    if (ch === "'") { buf += ch; inSingle = true; i++; continue; }

    const dollarMatch = rest.match(/^\$[A-Za-z_]*\$/);
    if (dollarMatch) {
      dollarTag = dollarMatch[0];
      buf += dollarTag;
      i += dollarTag.length;
      continue;
    }
    if (ch === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i++; continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  // Drop statements that are only comments/whitespace.
  return out.filter((s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 0);
}

async function run(stmt) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Neon-Connection-String': CONN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: stmt, params: [] }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, json, text };
}

const args = process.argv.slice(2);
let script;
if (args[0] === '-c') script = args[1];
else script = readFileSync(args[0], 'utf8');

const statements = splitStatements(script);
console.log(`${statements.length} statement(s)\n`);

let failures = 0;
for (const [n, stmt] of statements.entries()) {
  const label = stmt.replace(/\s+/g, ' ').slice(0, 78);
  const r = await run(stmt);
  if (r.ok) {
    const cmd = r.json?.command ?? 'OK';
    const rows = r.json?.rows;
    console.log(`  [${String(n + 1).padStart(3)}] ${cmd.padEnd(8)} ${label}`);
    if (rows?.length) for (const row of rows.slice(0, 30)) console.log('        ', JSON.stringify(row));
  } else {
    failures++;
    const msg = r.json?.message ?? r.json?.error ?? r.text.slice(0, 300);
    console.log(`  [${String(n + 1).padStart(3)}] \x1b[31mFAIL\x1b[0m     ${label}`);
    console.log(`         -> ${msg}`);
  }
}

console.log(`\n${statements.length - failures}/${statements.length} succeeded`);
if (failures) process.exit(1);
