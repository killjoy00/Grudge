#!/usr/bin/env node
/**
 * One-time authenticated backfill of prior seasons for league 114052.
 *
 * WHY THIS EXISTS
 * ---------------
 * Step 1 exploration established that seasons 2018-2025 exist but are NOT
 * publicly readable:
 *
 *   /leagueHistory/114052?seasonId=YEAR   -> 404 for every year (endpoint dead)
 *   /seasons/{2018..2025}/.../114052      -> 401 AUTH_LEAGUE_NOT_VISIBLE
 *   /seasons/2026/.../114052              -> 200 OK
 *   a nonexistent league id               -> 404 in those same years
 *
 * The 401-vs-404 split is what tells us the data is really there. Reaching it
 * needs the two cookies ESPN sets for a logged-in member of the league.
 *
 * SECURITY
 * --------
 * Run this on YOUR machine, never in CI. The cookies are read from the
 * environment, are never written to disk, and are never logged (see redact()).
 * The weekly pipeline stays unauthenticated and public; this script is a
 * one-time capture whose OUTPUT is what gets committed.
 *
 * USAGE
 * -----
 *   export ESPN_SWID='{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}'   # keep the braces
 *   export ESPN_S2='AEB...'                                     # long, url-encoded
 *   node scripts/backfill-history.mjs                  # 2018-2025, boxscores on
 *   node scripts/backfill-history.mjs --from=2021 --to=2023
 *   node scripts/backfill-history.mjs --no-boxscores   # ~8x fewer requests
 *   node scripts/backfill-history.mjs --probe          # auth check only, no writes
 *
 * IDEMPOTENCE / ATOMICITY
 * -----------------------
 * Each season is staged in data/.staging/{season} and only moved into
 * data/history/{season} once every request for that season succeeded. A season
 * that errors part-way leaves NOTHING behind, so a partial season can never be
 * committed. Re-running overwrites a season wholesale rather than merging.
 */

import { mkdirSync, writeFileSync, rmSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'data');
const HISTORY = join(DATA, 'history');
const STAGING = join(DATA, '.staging');

const LEAGUE_ID = 114052;

/* ------------------------------------------------------------------ config */

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const FROM = Number(opt('from', 2018));
const TO = Number(opt('to', 2025));
const WITH_BOXSCORES = !flag('no-boxscores');
const PROBE_ONLY = flag('probe');

// Views worth capturing per season. mMatchupScore rather than mMatchup: Step 1
// showed only mMatchupScore carries playoffTierType, pointsByScoringPeriod and
// the final `winner`, which is what head-to-head records are built from.
const SEASON_VIEWS = [
  'mTeam',
  'mSettings',
  'mMatchupScore',
  'mStandings',
  'mTransactions2',
  'mRoster',
];

// Final scoring period for this league (14 regular + 3 playoff).
const MAX_SCORING_PERIOD = 17;

const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;

/* ------------------------------------------------------------------- utils */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Strip anything cookie-shaped out of text before it can reach a log. */
function redact(text) {
  let out = String(text);
  if (SWID) out = out.split(SWID).join('«SWID»');
  if (ESPN_S2) out = out.split(ESPN_S2).join('«ESPN_S2»');
  return out;
}

function log(...parts) {
  console.log(redact(parts.join(' ')));
}

function die(msg) {
  console.error('\n[31mERROR[0m ' + redact(msg) + '\n');
  process.exit(1);
}

/* ----------------------------------------------------------------- fetching */

const HEADERS = {
  accept: 'application/json',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}`,
};

/**
 * Fetch with bounded retries. Retries transport errors and 5xx/429 only --
 * a 401 or 404 is a real answer about the data and must not be retried.
 */
async function fetchJson(url, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s, 8s
      log(`      retry ${attempt}/${retries} in ${backoff}ms`);
      await sleep(backoff);
    }
    try {
      const res = await fetch(url, { headers: HEADERS });
      const text = await res.text();
      if (res.status >= 500 || res.status === 429) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) {
        return { ok: false, status: res.status, body: text.slice(0, 300), json: null };
      }
      try {
        return { ok: true, status: res.status, json: JSON.parse(text), bytes: text.length };
      } catch (e) {
        lastErr = `unparseable JSON: ${e.message}`;
        continue;
      }
    } catch (e) {
      lastErr = e.message;
    }
  }
  return { ok: false, status: 0, body: lastErr, json: null };
}

/**
 * ESPN exposes prior seasons through two different URL shapes and which one
 * works varies by league and by year. Step 1 found leagueHistory 404s while
 * unauthenticated; it may or may not start working once cookies are attached.
 * Rather than guess, try both and record which actually answered.
 */
function urlsFor(season, viewParams) {
  const qs = viewParams.map((v) => `view=${v}`).join('&');
  return [
    {
      shape: 'seasons',
      url: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?${qs}`,
    },
    {
      shape: 'leagueHistory',
      url: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${LEAGUE_ID}?seasonId=${season}&${qs}`,
    },
  ];
}

/** leagueHistory returns an array of league objects; seasons returns one. */
function unwrap(json) {
  if (Array.isArray(json)) return json.length === 1 ? json[0] : json;
  return json;
}

function looksLikeLeague(json) {
  const d = unwrap(json);
  if (!d || typeof d !== 'object') return false;
  return Boolean(d.id || d.teams || d.schedule || d.settings);
}

/* -------------------------------------------------------------------- probe */

async function probeAuth() {
  log('Checking cookies against a season that is public (2026) and one that is not (2025)...\n');

  const pub = await fetchJson(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/${LEAGUE_ID}?view=mSettings`
  );
  log(`  2026 (public baseline): HTTP ${pub.status}`);
  if (!pub.ok) {
    die(
      'Even the public 2026 season failed. That is a network or proxy problem, not a cookie ' +
        'problem -- the cookies are not needed for 2026 at all.'
    );
  }

  const results = [];
  for (const season of [2025, 2024, 2018]) {
    for (const { shape, url } of urlsFor(season, ['mSettings'])) {
      const r = await fetchJson(url, { retries: 1 });
      results.push({ season, shape, status: r.status, ok: r.ok && looksLikeLeague(r.json) });
      log(`  ${season} via ${shape.padEnd(13)}: HTTP ${r.status}${r.ok ? '' : '  ' + redact(r.body || '')}`);
      await sleep(350);
    }
  }

  const anyWorked = results.some((r) => r.ok);
  if (!anyWorked) {
    const got401 = results.some((r) => r.status === 401);
    die(
      got401
        ? 'Still 401 on every prior season. The cookies were sent but rejected. Most common causes:\n' +
            '   - ESPN_SWID is missing its surrounding { } braces\n' +
            '   - ESPN_S2 was truncated on copy (it is very long) or got URL-decoded\n' +
            '   - the logged-in ESPN account is not a member of league 114052\n' +
            '   - the session expired; log in again and re-copy both cookies\n' +
            '   See docs/SETUP.md for how to copy them exactly.'
        : 'Prior seasons did not return league data. See the statuses above.'
    );
  }

  const working = results.filter((r) => r.ok);
  log(`\n[32mCookies work.[0m Reachable via: ${[...new Set(working.map((w) => w.shape))].join(', ')}`);
  log(`Seasons confirmed readable in this probe: ${[...new Set(working.map((w) => w.season))].join(', ')}`);
  return working[0].shape;
}

/* ------------------------------------------------------------------ capture */

async function captureSeason(season, preferredShape) {
  const stage = join(STAGING, String(season));
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  const manifest = {
    season,
    leagueId: LEAGUE_ID,
    capturedAt: new Date().toISOString(),
    urlShape: null,
    views: {},
    boxscores: {},
    warnings: [],
  };

  // Order the two URL shapes so the one that answered during the probe is tried
  // first, but keep the other as a fallback -- ESPN is not consistent year to year.
  const shapes = urlsFor(season, SEASON_VIEWS);
  shapes.sort((a, b) => (a.shape === preferredShape ? -1 : b.shape === preferredShape ? 1 : 0));

  let combined = null;
  for (const { shape, url } of shapes) {
    const r = await fetchJson(url);
    if (r.ok && looksLikeLeague(r.json)) {
      combined = unwrap(r.json);
      manifest.urlShape = shape;
      log(`   all views via ${shape}: HTTP ${r.status}, ${(r.bytes / 1024).toFixed(0)} KB`);
      break;
    }
    log(`   ${shape}: HTTP ${r.status} -- ${redact(r.body || 'no league data')}`);
    await sleep(350);
  }

  if (!combined) {
    throw new Error(`no URL shape returned league data for ${season}`);
  }

  // Sanity-check that the season actually looks played, so we do not silently
  // archive an empty shell (e.g. a season that was created but never used).
  const teams = combined.teams || [];
  const schedule = combined.schedule || [];
  const decided = schedule.filter((m) => m.winner && m.winner !== 'UNDECIDED').length;
  if (!teams.length) manifest.warnings.push('no teams in payload');
  if (!schedule.length) manifest.warnings.push('no schedule in payload');
  if (schedule.length && decided === 0) {
    manifest.warnings.push('schedule present but no matchup has a winner -- season may be unplayed');
  }
  log(
    `   teams: ${teams.length}  matchups: ${schedule.length}  decided: ${decided}` +
      (manifest.warnings.length ? `  [33m(${manifest.warnings.length} warning)[0m` : '')
  );

  writeFileSync(join(stage, 'league.json'), JSON.stringify(combined, null, 2));
  manifest.views.combined = 'league.json';

  // Per-week boxscores: the only source of per-player weekly points, which is
  // what optimal-vs-actual lineup history needs. Step 1 confirmed the field
  // path is schedule[].{home,away}.rosterForCurrentScoringPeriod.entries[].
  if (WITH_BOXSCORES) {
    const bxDir = join(stage, 'boxscores');
    mkdirSync(bxDir, { recursive: true });
    for (let sp = 1; sp <= MAX_SCORING_PERIOD; sp++) {
      const base =
        manifest.urlShape === 'leagueHistory'
          ? `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${LEAGUE_ID}?seasonId=${season}&view=mBoxscore&scoringPeriodId=${sp}`
          : `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?view=mBoxscore&scoringPeriodId=${sp}`;
      const r = await fetchJson(base);
      if (!r.ok) {
        throw new Error(`boxscore ${season} SP${sp}: HTTP ${r.status} ${redact(r.body || '')}`);
      }
      const data = unwrap(r.json);
      writeFileSync(join(bxDir, `sp${String(sp).padStart(2, '0')}.json`), JSON.stringify(data, null, 2));
      manifest.boxscores[sp] = (data.schedule || []).length;
      process.stdout.write(`   boxscores: SP${sp}/${MAX_SCORING_PERIOD}\r`);
      await sleep(350);
    }
    log(`   boxscores: ${MAX_SCORING_PERIOD}/${MAX_SCORING_PERIOD} captured        `);
  } else {
    manifest.warnings.push('boxscores skipped (--no-boxscores)');
  }

  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Atomic-ish promote: only now does anything appear under data/history.
  const dest = join(HISTORY, String(season));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(HISTORY, { recursive: true });
  renameSync(stage, dest);

  return manifest;
}

/* --------------------------------------------------------------------- main */

async function main() {
  if (!SWID || !ESPN_S2) {
    die(
      'ESPN_SWID and ESPN_S2 must both be set.\n' +
        "   export ESPN_SWID='{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}'\n" +
        "   export ESPN_S2='AEB...'\n" +
        '   See docs/SETUP.md for how to copy them out of your browser.'
    );
  }
  if (!/^\{.*\}$/.test(SWID)) {
    die('ESPN_SWID must include the surrounding { } braces, exactly as the cookie stores it.');
  }

  log(`League ${LEAGUE_ID} history backfill`);
  log(`Seasons ${FROM}-${TO}${WITH_BOXSCORES ? ' with' : ' without'} per-week boxscores\n`);

  const preferredShape = await probeAuth();
  if (PROBE_ONLY) {
    log('\n--probe given, stopping before any writes.');
    return;
  }

  mkdirSync(STAGING, { recursive: true });
  const done = [];
  const failed = [];

  for (let season = FROM; season <= TO; season++) {
    log(`\n[1m${season}[0m`);
    try {
      const m = await captureSeason(season, preferredShape);
      done.push({ season, warnings: m.warnings });
    } catch (e) {
      log(`   [31mfailed:[0m ${redact(e.message)}`);
      failed.push({ season, error: redact(e.message) });
      rmSync(join(STAGING, String(season)), { recursive: true, force: true });
    }
    await sleep(500);
  }

  rmSync(STAGING, { recursive: true, force: true });

  // Index across whatever ended up on disk, so it reflects reality rather than
  // this run -- a re-run for one season leaves the others' entries intact.
  const onDisk = existsSync(HISTORY)
    ? readdirSync(HISTORY).filter((d) => /^\d{4}$/.test(d)).sort()
    : [];
  writeFileSync(
    join(HISTORY, 'index.json'),
    JSON.stringify(
      { leagueId: LEAGUE_ID, updatedAt: new Date().toISOString(), seasons: onDisk },
      null,
      2
    )
  );

  log('\n' + '-'.repeat(60));
  log(`captured: ${done.map((d) => d.season).join(', ') || 'none'}`);
  const warned = done.filter((d) => d.warnings.length);
  for (const w of warned) log(`  [33mwarning[0m ${w.season}: ${w.warnings.join('; ')}`);
  if (failed.length) {
    log(`failed:   ${failed.map((f) => `${f.season} (${f.error})`).join(', ')}`);
    log('\nNothing was written for the failed seasons. Re-run to retry just those:');
    log(`  node scripts/backfill-history.mjs --from=${failed[0].season} --to=${failed[0].season}`);
  }
  log(`\nseasons on disk: ${onDisk.join(', ') || 'none'}`);
  log('Review data/history/, then commit it. The cookies stay on this machine.');

  if (failed.length) process.exit(1);
}

await main();
