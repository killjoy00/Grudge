/**
 * THROWAWAY exploration script -- Step 1.
 * Fetches each ESPN v3 view for the league, dumps raw JSON to exploration/raw/,
 * and writes structural summaries (path -> types + sample values) to exploration/.
 *
 * Nothing here is production code. Its only job is to tell us what fields
 * actually exist before we design a schema.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, 'raw');
mkdirSync(RAW, { recursive: true });

const LEAGUE_ID = 114052;
const SEASON = 2026;
const BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`;
const HISTORY = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${LEAGUE_ID}`;

const HEADERS = {
  accept: 'application/json',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, extraHeaders = {}) {
  const started = Date.now();
  const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders } });
  const text = await res.text();
  const meta = { url, status: res.status, ms: Date.now() - started, bytes: text.length };
  if (!res.ok) return { meta, error: text.slice(0, 400), json: null };
  try {
    return { meta, json: JSON.parse(text) };
  } catch (e) {
    return { meta, error: `parse: ${e.message}`, json: null };
  }
}

/* ---------- structure summarizer ---------- */
// Walks JSON, collapsing every array index to [] so that 10 teams x 16 players
// produce one path each, then records observed types + a few distinct samples.
function walk(node, path, acc, depth = 0) {
  if (depth > 14) return;
  const rec = (p, type, sample) => {
    let e = acc.get(p);
    if (!e) { e = { types: new Set(), samples: new Set(), count: 0 }; acc.set(p, e); }
    e.types.add(type);
    e.count++;
    if (sample !== undefined && e.samples.size < 6) {
      const s = typeof sample === 'string' ? JSON.stringify(sample.slice(0, 60)) : String(sample);
      e.samples.add(s);
    }
  };
  if (node === null) return rec(path, 'null');
  if (Array.isArray(node)) {
    rec(path, `array(len=${node.length})`);
    // sample up to 25 elements -- enough to catch union shapes without blowing up
    for (const item of node.slice(0, 25)) walk(item, `${path}[]`, acc, depth + 1);
    return;
  }
  const t = typeof node;
  if (t === 'object') {
    rec(path, 'object');
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, acc, depth + 1);
    return;
  }
  rec(path, t, node);
}

function summarize(json) {
  const acc = new Map();
  walk(json, '', acc);
  const lines = [];
  for (const p of [...acc.keys()].sort()) {
    const e = acc.get(p);
    const types = [...e.types].join('|');
    const samples = [...e.samples];
    lines.push(
      `${p || '<root>'}  ::  ${types}  (n=${e.count})` +
        (samples.length ? `  e.g. ${samples.join(', ')}` : '')
    );
  }
  return lines.join('\n');
}

/* ---------- targets ---------- */
const VIEWS = [
  'mTeam', 'mRoster', 'mMatchup', 'mMatchupScore',
  'mStandings', 'mSettings', 'mTransactions2',
];

const results = [];
const log = [];
function note(s) { console.log(s); log.push(s); }

// 1. each view on its own
for (const view of VIEWS) {
  const { meta, json, error } = await fetchJson(`${BASE}?view=${view}`);
  note(`[view] ${view}: HTTP ${meta.status} ${meta.bytes}B ${meta.ms}ms${error ? ' ERR ' + error : ''}`);
  if (json) {
    writeFileSync(join(RAW, `2026_${view}.json`), JSON.stringify(json, null, 2));
    writeFileSync(join(RAW, `2026_${view}.paths.txt`), summarize(json));
    note(`   top-level keys: ${Object.keys(json).join(', ')}`);
  }
  results.push({ label: view, ...meta, ok: !!json });
  await sleep(250);
}

// 2. variants that ESPN is known to gate on extra params -- confirm empirically
const VARIANTS = [
  ['mMatchup_sp1', `${BASE}?view=mMatchup&scoringPeriodId=1`],
  ['mMatchupScore_sp1', `${BASE}?view=mMatchupScore&scoringPeriodId=1`],
  ['mRoster_sp1', `${BASE}?view=mRoster&scoringPeriodId=1`],
  ['mBoxscore_sp1', `${BASE}?view=mBoxscore&scoringPeriodId=1`],
  ['mTransactions2_sp1', `${BASE}?view=mTransactions2&scoringPeriodId=1`],
  ['multiview', `${BASE}?view=mTeam&view=mRoster&view=mMatchup&view=mSettings&view=mStandings`],
  ['no_view', `${BASE}`],
  ['mPendingTransactions', `${BASE}?view=mPendingTransactions`],
  ['mNav', `${BASE}?view=mNav`],
];
for (const [label, url] of VARIANTS) {
  const { meta, json, error } = await fetchJson(url);
  note(`[variant] ${label}: HTTP ${meta.status} ${meta.bytes}B${error ? ' ERR ' + error : ''}`);
  if (json) {
    writeFileSync(join(RAW, `2026_${label}.json`), JSON.stringify(json, null, 2));
    writeFileSync(join(RAW, `2026_${label}.paths.txt`), summarize(json));
    note(`   top-level keys: ${Object.keys(json).join(', ')}`);
  }
  results.push({ label, ...meta, ok: !!json });
  await sleep(250);
}

// 3. league history -- does this league ID have prior seasons at all?
const historyFound = [];
for (let y = 2012; y <= 2026; y++) {
  const { meta, json } = await fetchJson(`${HISTORY}?seasonId=${y}&view=mTeam&view=mSettings`);
  const arr = Array.isArray(json) ? json : json ? [json] : [];
  const present = arr.length > 0 && arr[0] && (arr[0].id || arr[0].teams);
  note(`[history] ${y}: HTTP ${meta.status} ${meta.bytes}B -> ${present ? 'DATA' : 'empty'}`);
  if (present) {
    historyFound.push(y);
    writeFileSync(join(RAW, `history_${y}.json`), JSON.stringify(json, null, 2));
    writeFileSync(join(RAW, `history_${y}.paths.txt`), summarize(json));
  }
  results.push({ label: `history_${y}`, ...meta, ok: present });
  await sleep(250);
}
note(`[history] seasons with data: ${historyFound.length ? historyFound.join(', ') : 'NONE'}`);

// 4. kona_player_info + X-Fantasy-Filter (free agent pool -- needed for Step 8)
const konaFilter = {
  players: {
    filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
    limit: 25,
    sortPercOwned: { sortAsc: false, sortPriority: 1 },
  },
};
{
  const { meta, json, error } = await fetchJson(`${BASE}?view=kona_player_info`, {
    'x-fantasy-filter': JSON.stringify(konaFilter),
  });
  note(`[kona] kona_player_info: HTTP ${meta.status} ${meta.bytes}B${error ? ' ERR ' + error : ''}`);
  if (json) {
    writeFileSync(join(RAW, `2026_kona_player_info.json`), JSON.stringify(json, null, 2));
    writeFileSync(join(RAW, `2026_kona_player_info.paths.txt`), summarize(json));
  }
  results.push({ label: 'kona_player_info', ...meta, ok: !!json });
}

writeFileSync(join(HERE, 'fetch-log.txt'), log.join('\n'));
writeFileSync(join(HERE, 'fetch-results.json'), JSON.stringify(results, null, 2));
note('\nDone.');
