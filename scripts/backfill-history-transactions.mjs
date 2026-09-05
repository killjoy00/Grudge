#!/usr/bin/env node
/**
 * Repair the 2018-2025 ESPN archive with week-scoped transaction data.
 *
 * The original historical capture requested mTransactions2 only as part of a
 * season-wide multi-view response. ESPN's historical API does not populate the
 * useful waiver/free-agent ledger that way; it must be requested with a
 * scoringPeriodId. This script intentionally leaves the existing matchup and
 * boxscore captures untouched and only augments league.json.gz with the merged,
 * deduplicated transaction ledger.
 *
 * Usage:
 *   node scripts/backfill-history-transactions.mjs --probe
 *   node scripts/backfill-history-transactions.mjs
 *   node scripts/backfill-history-transactions.mjs --from=2024 --to=2025
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { mergeTransactions } from './history-backfill-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const HISTORY = join(ROOT, 'data', 'history');
const LEAGUE_ID = 114052;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const FROM = Number(opt('from', '2018'));
const TO = Number(opt('to', '2025'));
const PROBE_ONLY = flag('probe');
const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;

if (!Number.isInteger(FROM) || !Number.isInteger(TO) || FROM > TO) {
  throw new Error(`invalid season range: ${FROM}-${TO}`);
}
if (!SWID || !ESPN_S2) {
  throw new Error('ESPN_SWID and ESPN_S2 must both be set in the environment.');
}
if (!/^\{.*\}$/.test(SWID)) {
  throw new Error('ESPN_SWID must include its surrounding { } braces.');
}

const HEADERS = {
  accept: 'application/json',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}`,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function redact(value) {
  let out = String(value ?? '');
  if (SWID) out = out.split(SWID).join('«SWID»');
  if (ESPN_S2) out = out.split(ESPN_S2).join('«ESPN_S2»');
  return out;
}

function log(...parts) {
  console.log(redact(parts.join(' ')));
}

function readGzipJson(path) {
  return JSON.parse(gunzipSync(readFileSync(path)).toString());
}

function writeGzipJson(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, gzipSync(JSON.stringify(value), { level: 9 }));
  renameSync(tmp, path);
}

function writeJson(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

function unwrap(json) {
  return Array.isArray(json) && json.length === 1 ? json[0] : json;
}

function scoringPeriods(league) {
  const periods = league.settings?.scheduleSettings?.matchupPeriods ?? {};
  const values = Object.values(periods).flatMap((list) =>
    Array.isArray(list) ? list.filter((value) => Number.isInteger(value)) : []
  );
  const max = values.length ? Math.max(...values) : 17;
  return Array.from({ length: max }, (_, index) => index + 1);
}

function transactionUrl(season, scoringPeriodId, shape) {
  const query = `view=mTransactions2&scoringPeriodId=${scoringPeriodId}`;
  if (shape === 'leagueHistory') {
    return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${LEAGUE_ID}?seasonId=${season}&${query}`;
  }
  return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?${query}`;
}

async function fetchJson(url, retries = 4) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, { headers: HEADERS });
      const text = await response.text();
      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) {
        return { ok: false, status: response.status, body: text.slice(0, 300) };
      }
      try {
        return { ok: true, status: response.status, json: JSON.parse(text) };
      } catch (error) {
        lastError = `unparseable JSON: ${error.message}`;
      }
    } catch (error) {
      lastError = error.message;
    }
  }
  return { ok: false, status: 0, body: lastError ?? 'unknown fetch error' };
}

async function fetchPeriod(season, scoringPeriodId, preferredShape) {
  const shapes = preferredShape === 'leagueHistory'
    ? ['leagueHistory', 'seasons']
    : ['seasons', 'leagueHistory'];

  const failures = [];
  for (const shape of shapes) {
    const result = await fetchJson(transactionUrl(season, scoringPeriodId, shape));
    if (result.ok) {
      const payload = unwrap(result.json);
      if (payload && typeof payload === 'object') {
        return { payload, shape, status: result.status };
      }
    }
    failures.push(`${shape}=HTTP ${result.status} ${redact(result.body ?? '')}`.trim());
    await sleep(250);
  }

  throw new Error(`${season} week ${scoringPeriodId}: ${failures.join('; ')}`);
}

async function probe() {
  const season = Math.min(Math.max(2025, FROM), TO);
  const leaguePath = join(HISTORY, String(season), 'league.json.gz');
  if (!existsSync(leaguePath)) {
    throw new Error(`data/history/${season}/league.json.gz is missing`);
  }
  const manifestPath = join(HISTORY, String(season), 'manifest.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {};
  const preferredShape = manifest.urlShape === 'leagueHistory' ? 'leagueHistory' : 'seasons';

  log(`Checking ESPN history authentication with ${season} week 1...`);
  const result = await fetchPeriod(season, 1, preferredShape);
  log(`  HTTP ${result.status} via ${result.shape}`);
  log(`  transactions returned: ${(result.payload.transactions ?? []).length}`);
  log('Cookies work. No files were changed.');
}

async function repairSeason(season) {
  const dir = join(HISTORY, String(season));
  const leaguePath = join(dir, 'league.json.gz');
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(leaguePath)) {
    throw new Error(`data/history/${season}/league.json.gz is missing`);
  }

  const league = readGzipJson(leaguePath);
  league.seasonId ??= season;
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { season, leagueId: LEAGUE_ID };
  const preferredShape = manifest.urlShape === 'leagueHistory' ? 'leagueHistory' : 'seasons';
  const periods = scoringPeriods(league);

  const captures = [];
  let resolvedShape = preferredShape;
  log(`\n${season}: fetching ${periods.length} scoring periods`);

  for (const period of periods) {
    const result = await fetchPeriod(season, period, resolvedShape);
    resolvedShape = result.shape;
    const payload = result.payload;
    payload.seasonId ??= season;
    captures.push({ period, payload });
    process.stdout.write(`  transactions: week ${period}/${periods.length}\r`);
    await sleep(350);
  }
  process.stdout.write(' '.repeat(60) + '\r');

  // Some ESPN transaction responses repeat earlier rows. Later scoring-period
  // captures win during deduplication, which preserves a final EXECUTED envelope
  // if an earlier response exposed the same transaction as pending.
  const transactions = mergeTransactions([
    { transactions: league.transactions ?? [] },
    ...captures.map(({ payload }) => payload),
  ]);
  league.transactions = transactions;

  // All network work succeeded before anything is written. Raw per-period
  // transaction responses are staged in a temporary directory, then promoted.
  const stagingDir = join(dir, '.transactions-staging');
  const transactionDir = join(dir, 'transactions');
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  for (const { period, payload } of captures) {
    writeFileSync(
      join(stagingDir, `sp${String(period).padStart(2, '0')}.json.gz`),
      gzipSync(JSON.stringify(payload), { level: 9 })
    );
  }

  writeGzipJson(leaguePath, league);
  rmSync(transactionDir, { recursive: true, force: true });
  renameSync(stagingDir, transactionDir);

  const byType = transactions.reduce((counts, transaction) => {
    const type = transaction.type ?? 'UNKNOWN';
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
  const perPeriod = Object.fromEntries(
    captures.map(({ period, payload }) => [period, (payload.transactions ?? []).length])
  );
  manifest.transactionBackfill = {
    capturedAt: new Date().toISOString(),
    urlShape: resolvedShape,
    scoringPeriods: periods.length,
    totalUniqueTransactions: transactions.length,
    perPeriod,
    byType,
  };
  writeJson(manifestPath, manifest);

  log(`  unique transactions: ${transactions.length}`);
  log(`  types: ${Object.entries(byType).map(([type, count]) => `${type}=${count}`).join(' ') || 'none'}`);
}

async function main() {
  if (PROBE_ONLY) {
    await probe();
    return;
  }

  const failed = [];
  for (let season = FROM; season <= TO; season += 1) {
    try {
      await repairSeason(season);
    } catch (error) {
      log(`\n${season} failed: ${redact(error.message)}`);
      failed.push({ season, error: redact(error.message) });
    }
  }

  log('\nHistorical transaction repair complete.');
  if (failed.length) {
    for (const failure of failed) log(`  failed ${failure.season}: ${failure.error}`);
    process.exitCode = 1;
  } else {
    log(`  repaired ${FROM}-${TO}`);
    log('  review data/history/, then commit the changed archive files');
  }
}

await main();
