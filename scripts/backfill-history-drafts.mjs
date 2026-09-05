#!/usr/bin/env node
/**
 * Fill the one known 2018-2025 archive hole: mDraftDetail.
 *
 * The original historical capture saved matchups, rosters and standings but
 * did not request ESPN's draft view. This script fetches ONLY mDraftDetail and
 * merges it into the existing data/history/<season>/league.json.gz payload,
 * leaving every other archived field untouched.
 *
 * Historical ESPN data requires the authenticated SWID + espn_s2 cookies.
 * Never print either value.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY = join(ROOT, 'data', 'history');
const LEAGUE_ID = 114052;
const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const FROM = Number(opt('from', '2018'));
const TO = Number(opt('to', '2025'));
const PROBE = args.includes('--probe');
const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;

if (!SWID || !ESPN_S2) throw new Error('ESPN_SWID and ESPN_S2 are required.');
if (!/^\{.*\}$/.test(SWID)) throw new Error('ESPN_SWID must include its surrounding { } braces.');
if (!Number.isInteger(FROM) || !Number.isInteger(TO) || FROM > TO || FROM < 2018 || TO > 2025) {
  throw new Error('Draft repair is intentionally limited to historical ESPN seasons 2018-2025.');
}

const HEADERS = {
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}`,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unwrap = (value) => Array.isArray(value) && value.length === 1 ? value[0] : value;

function redact(value) {
  return String(value ?? '').split(SWID).join('«SWID»').split(ESPN_S2).join('«ESPN_S2»');
}

function urls(season) {
  return [
    `${BASE}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?view=mDraftDetail`,
    `${BASE}/leagueHistory/${LEAGUE_ID}?seasonId=${season}&view=mDraftDetail`,
  ];
}

async function fetchDraft(season) {
  const failures = [];
  for (const url of urls(season)) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
      try {
        const response = await fetch(url, { headers: HEADERS });
        const text = await response.text();
        if (response.status === 429 || response.status >= 500) continue;
        if (!response.ok) {
          failures.push(`HTTP ${response.status}`);
          break;
        }
        const data = unwrap(JSON.parse(text));
        const picks = data?.draftDetail?.picks ?? [];
        if (!Array.isArray(picks) || picks.length === 0) {
          failures.push(`HTTP ${response.status}, no draft picks`);
          break;
        }
        return { draftDetail: data.draftDetail, picks: picks.length };
      } catch (error) {
        failures.push(redact(error instanceof Error ? error.message : String(error)));
      }
    }
  }
  throw new Error(`${season}: mDraftDetail fetch failed (${failures.join('; ')})`);
}

function archivePath(season) {
  return join(HISTORY, String(season), 'league.json.gz');
}

function manifestPath(season) {
  return join(HISTORY, String(season), 'manifest.json');
}

function mergeDraftIntoArchive(season, draftDetail) {
  const path = archivePath(season);
  if (!existsSync(path)) throw new Error(`${season}: existing archive missing (${path}).`);
  const league = JSON.parse(gunzipSync(readFileSync(path)).toString());
  league.seasonId ??= season;
  league.draftDetail = draftDetail;
  writeFileSync(path, gzipSync(JSON.stringify(league), { level: 9 }));

  const manifestFile = manifestPath(season);
  if (existsSync(manifestFile)) {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    manifest.availability = {
      ...(manifest.availability ?? {}),
      draftBoard: true,
      draftPicks: draftDetail.picks?.length ?? 0,
    };
    manifest.draftBackfilledAt = new Date().toISOString();
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
}

async function main() {
  const seasons = [];
  for (let season = FROM; season <= TO; season += 1) {
    if (season === 2020) continue; // league did not play
    seasons.push(season);
  }

  if (PROBE) {
    const season = seasons.at(-1) ?? 2025;
    const draft = await fetchDraft(season);
    console.log(`Probe succeeded: ${season} returned ${draft.picks} draft picks. No files changed.`);
    return;
  }

  let total = 0;
  for (const season of seasons) {
    const draft = await fetchDraft(season);
    mergeDraftIntoArchive(season, draft.draftDetail);
    total += draft.picks;
    console.log(`${season}: merged ${draft.picks} draft picks into existing archive.`);
    await sleep(250);
  }
  console.log(`Historical draft repair complete: ${total} picks merged across ${seasons.length} played seasons.`);
}

await main();
