#!/usr/bin/env node
/**
 * Read-only probe for the pre-2018 ESPN archive.
 *
 * This intentionally writes nothing. It answers the question we did not test
 * during the original history work: how much of 2005-2017 ESPN still exposes
 * when an authenticated league member asks for the old season.
 *
 * It checks, per requested season:
 *   - teams/settings + the full matchup scoreboard
 *   - the draft board (mDraftDetail)
 *   - week 1 transactions (mTransactions2 + scoringPeriodId)
 *   - week 1 player boxscores (mBoxscore + scoringPeriodId)
 *
 * Usage:
 *   ESPN_SWID='{...}' ESPN_S2='...' node scripts/probe-legacy-history.mjs
 *   ... node scripts/probe-legacy-history.mjs --seasons=2005,2010,2017
 */

const LEAGUE_ID = 114052;
const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const seasons = opt('seasons', '2005,2010,2017')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value));

const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;
if (!SWID || !ESPN_S2) throw new Error('ESPN_SWID and ESPN_S2 are required.');
if (!/^\{.*\}$/.test(SWID)) throw new Error('ESPN_SWID must include its surrounding { } braces.');
if (!seasons.length) throw new Error('No valid seasons were supplied.');

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

function urlFor(season, views, shape, scoringPeriodId = null) {
  const qs = [
    ...views.map((view) => `view=${encodeURIComponent(view)}`),
    ...(scoringPeriodId == null ? [] : [`scoringPeriodId=${scoringPeriodId}`]),
  ].join('&');
  if (shape === 'leagueHistory') {
    return `${BASE}/leagueHistory/${LEAGUE_ID}?seasonId=${season}&${qs}`;
  }
  return `${BASE}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?${qs}`;
}

async function fetchJson(url, retries = 2) {
  let last = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(750 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, { headers: HEADERS });
      const text = await response.text();
      if (response.status === 429 || response.status >= 500) {
        last = `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) return { ok: false, status: response.status, body: text.slice(0, 240) };
      try {
        return { ok: true, status: response.status, json: unwrap(JSON.parse(text)), bytes: text.length };
      } catch (error) {
        last = `unparseable JSON: ${error.message}`;
      }
    } catch (error) {
      last = error.message;
    }
  }
  return { ok: false, status: 0, body: last || 'unknown error' };
}

async function fetchAny(season, views, scoringPeriodId = null, preferred = null) {
  const shapes = preferred === 'leagueHistory'
    ? ['leagueHistory', 'seasons']
    : preferred === 'seasons'
      ? ['seasons', 'leagueHistory']
      : ['seasons', 'leagueHistory'];
  const failures = [];
  for (const shape of shapes) {
    const result = await fetchJson(urlFor(season, views, shape, scoringPeriodId));
    const data = result.json;
    if (result.ok && data && typeof data === 'object') {
      return { ...result, data, shape };
    }
    failures.push(`${shape}=HTTP ${result.status} ${redact(result.body ?? '')}`.trim());
    await sleep(150);
  }
  throw new Error(failures.join('; '));
}

function rosterEntryCount(boxscore) {
  let total = 0;
  for (const matchup of boxscore.schedule ?? []) {
    total += matchup.home?.rosterForCurrentScoringPeriod?.entries?.length ?? 0;
    total += matchup.away?.rosterForCurrentScoringPeriod?.entries?.length ?? 0;
  }
  return total;
}

let readable = 0;
for (const season of seasons) {
  console.log(`\n=== ${season} ===`);
  try {
    const core = await fetchAny(
      season,
      ['mTeam', 'mSettings', 'mMatchupScore', 'mStandings', 'mDraftDetail']
    );
    readable += 1;
    const league = core.data;
    const teams = league.teams ?? [];
    const schedule = league.schedule ?? [];
    const decided = schedule.filter((matchup) => matchup.winner && matchup.winner !== 'UNDECIDED').length;
    const draftPicks = league.draftDetail?.picks ?? [];
    const matchupPeriods = league.settings?.scheduleSettings?.matchupPeriods ?? {};
    const scoringPeriods = Object.values(matchupPeriods)
      .flatMap((value) => Array.isArray(value) ? value : [])
      .filter(Number.isInteger);
    const maxScoringPeriod = scoringPeriods.length ? Math.max(...scoringPeriods) : null;

    console.log(
      `core: HTTP ${core.status} via ${core.shape}; teams=${teams.length}; ` +
      `matchups=${schedule.length}; decided=${decided}; draftPicks=${draftPicks.length}; ` +
      `maxScoringPeriod=${maxScoringPeriod ?? 'unknown'}`
    );

    try {
      const tx = await fetchAny(season, ['mTransactions2'], 1, core.shape);
      console.log(`week 1 transactions: HTTP ${tx.status} via ${tx.shape}; rows=${(tx.data.transactions ?? []).length}`);
    } catch (error) {
      console.log(`week 1 transactions: unavailable (${redact(error.message)})`);
    }

    try {
      const bx = await fetchAny(season, ['mBoxscore'], 1, core.shape);
      console.log(
        `week 1 boxscore: HTTP ${bx.status} via ${bx.shape}; ` +
        `matchups=${(bx.data.schedule ?? []).length}; rosterEntries=${rosterEntryCount(bx.data)}`
      );
    } catch (error) {
      console.log(`week 1 boxscore: unavailable (${redact(error.message)})`);
    }
  } catch (error) {
    console.log(`core archive unavailable: ${redact(error.message)}`);
  }
}

console.log(`\nReadable legacy probe seasons: ${readable}/${seasons.length}`);
if (readable === 0) process.exitCode = 1;
