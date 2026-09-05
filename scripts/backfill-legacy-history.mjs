#!/usr/bin/env node
/**
 * Recover the authenticated 2005-2017 ESPN league archive.
 *
 * Unlike the original 2018+ capture, ESPN's old leagueHistory endpoint still
 * exposes season-level scoreboards and draft boards all the way back to 2005.
 * Player-level historical boxscores are only shells in this era, so this script
 * deliberately archives what ESPN actually still has:
 *   - teams, owners, settings and standings
 *   - every weekly matchup score / playoff game
 *   - the full mDraftDetail board
 *   - mRoster's surviving player metadata
 *   - a scoring-period-by-scoring-period transaction scan
 *
 * Existing commissioner standings remain authoritative for final placement and
 * championships. These captures add the missing game-level evidence; they do
 * not rewrite the manual history files.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { mergeTransactions } from './history-backfill-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'data');
const HISTORY = join(DATA, 'history');
const STAGING = join(DATA, '.legacy-history-staging');
const LEAGUE_ID = 114052;
const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const FROM = Number(opt('from', '2005'));
const TO = Number(opt('to', '2017'));

const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;
if (!SWID || !ESPN_S2) throw new Error('ESPN_SWID and ESPN_S2 are required.');
if (!/^\{.*\}$/.test(SWID)) throw new Error('ESPN_SWID must include its surrounding { } braces.');
if (!Number.isInteger(FROM) || !Number.isInteger(TO) || FROM > TO) {
  throw new Error(`Invalid season range ${FROM}-${TO}.`);
}
if (FROM < 2005 || TO > 2017) {
  throw new Error('Legacy capture is intentionally limited to played pre-2018 seasons (2005-2017).');
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
  out = out.split(SWID).join('«SWID»');
  out = out.split(ESPN_S2).join('«ESPN_S2»');
  return out;
}

function unwrap(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function writeGzip(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzipSync(JSON.stringify(value), { level: 9 }));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function urlFor(season, views, shape, scoringPeriodId = null) {
  const params = [
    ...views.map((view) => `view=${encodeURIComponent(view)}`),
    ...(scoringPeriodId == null ? [] : [`scoringPeriodId=${scoringPeriodId}`]),
  ].join('&');
  if (shape === 'leagueHistory') {
    return `${BASE}/leagueHistory/${LEAGUE_ID}?seasonId=${season}&${params}`;
  }
  return `${BASE}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?${params}`;
}

async function fetchJson(url, retries = 4) {
  let last = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, { headers: HEADERS });
      const text = await response.text();
      if (response.status === 429 || response.status >= 500) {
        last = `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) return { ok: false, status: response.status, body: text.slice(0, 300) };
      try {
        return { ok: true, status: response.status, json: unwrap(JSON.parse(text)), bytes: text.length };
      } catch (error) {
        last = `unparseable JSON: ${error.message}`;
      }
    } catch (error) {
      last = error.message;
    }
  }
  return { ok: false, status: 0, body: last || 'unknown fetch error' };
}

async function fetchAny(season, views, scoringPeriodId = null, preferred = 'leagueHistory') {
  const shapes = preferred === 'leagueHistory'
    ? ['leagueHistory', 'seasons']
    : ['seasons', 'leagueHistory'];
  const failures = [];
  for (const shape of shapes) {
    const result = await fetchJson(urlFor(season, views, shape, scoringPeriodId));
    if (result.ok && result.json && typeof result.json === 'object') {
      return { ...result, data: result.json, shape };
    }
    failures.push(`${shape}=HTTP ${result.status} ${redact(result.body ?? '')}`.trim());
    await sleep(150);
  }
  throw new Error(failures.join('; '));
}

function scoringPeriods(league) {
  const values = Object.values(league.settings?.scheduleSettings?.matchupPeriods ?? {})
    .flatMap((list) => Array.isArray(list) ? list : [])
    .filter(Number.isInteger);
  const max = values.length ? Math.max(...values) : 17;
  return Array.from({ length: max }, (_, index) => index + 1);
}

async function captureSeason(season) {
  const stage = join(STAGING, String(season));
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  console.log(`\n${season}: fetching scoreboard, teams, roster and draft`);
  const core = await fetchAny(
    season,
    ['mTeam', 'mSettings', 'mMatchupScore', 'mStandings', 'mRoster', 'mDraftDetail']
  );
  const league = core.data;
  league.seasonId ??= season;

  const teams = league.teams ?? [];
  const schedule = league.schedule ?? [];
  const decided = schedule.filter((matchup) => matchup.winner && matchup.winner !== 'UNDECIDED').length;
  const draftPicks = league.draftDetail?.picks ?? [];
  if (!teams.length || !schedule.length || decided === 0) {
    throw new Error(
      `${season}: legacy payload failed sanity check (teams=${teams.length}, matchups=${schedule.length}, decided=${decided})`
    );
  }
  console.log(
    `  ${core.shape}: teams=${teams.length}; matchups=${schedule.length}; decided=${decided}; draftPicks=${draftPicks.length}`
  );

  const periods = scoringPeriods(league);
  const transactionCaptures = [];
  let transactionShape = core.shape;
  console.log(`  scanning ${periods.length} scoring periods for transactions`);
  for (const period of periods) {
    const tx = await fetchAny(season, ['mTransactions2'], period, transactionShape);
    transactionShape = tx.shape;
    tx.data.seasonId ??= season;
    transactionCaptures.push({ period, data: tx.data });
    process.stdout.write(`  transactions: week ${period}/${periods.length}\r`);
    await sleep(250);
  }
  process.stdout.write(' '.repeat(60) + '\r');

  const transactions = mergeTransactions(transactionCaptures.map(({ data }) => data));
  league.transactions = transactions;

  writeGzip(join(stage, 'league.json.gz'), league);
  for (const { period, data } of transactionCaptures) {
    writeGzip(join(stage, 'transactions', `sp${String(period).padStart(2, '0')}.json.gz`), data);
  }

  const byType = transactions.reduce((counts, transaction) => {
    const type = transaction.type ?? 'UNKNOWN';
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
  writeJson(join(stage, 'manifest.json'), {
    season,
    leagueId: LEAGUE_ID,
    capturedAt: new Date().toISOString(),
    urlShape: core.shape,
    source: 'authenticated ESPN leagueHistory recovery',
    availability: {
      weeklyMatchupScores: true,
      draftBoard: draftPicks.length > 0,
      draftPicks: draftPicks.length,
      playerLevelWeeklyBoxscores: false,
      transactionScoringPeriodsScanned: periods.length,
      totalUniqueTransactions: transactions.length,
      transactionTypes: byType,
    },
  });

  const destination = join(HISTORY, String(season));
  rmSync(destination, { recursive: true, force: true });
  renameSync(stage, destination);
  console.log(
    `  captured: draft=${draftPicks.length}; transactions=${transactions.length}` +
      (Object.keys(byType).length ? ` (${Object.entries(byType).map(([type, n]) => `${type}=${n}`).join(' ')})` : '')
  );
}

async function main() {
  mkdirSync(STAGING, { recursive: true });
  const failures = [];
  for (let season = FROM; season <= TO; season += 1) {
    try {
      await captureSeason(season);
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error));
      console.error(`\n${season} failed: ${message}`);
      failures.push({ season, message });
    }
  }

  const seasons = readdirSync(HISTORY)
    .filter((name) => /^\d{4}$/.test(name) && existsSync(join(HISTORY, name, 'league.json.gz')))
    .sort();
  writeJson(join(HISTORY, 'index.json'), {
    leagueId: LEAGUE_ID,
    updatedAt: new Date().toISOString(),
    seasons,
  });
  rmSync(STAGING, { recursive: true, force: true });

  console.log(`\nLegacy history capture complete. Archive now covers: ${seasons.join(', ')}`);
  if (failures.length) {
    for (const failure of failures) console.error(`  failed ${failure.season}: ${failure.message}`);
    process.exitCode = 1;
  }
}

await main();
