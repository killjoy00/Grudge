#!/usr/bin/env node
const LEAGUE_ID = 114052;
const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;
if (!SWID || !ESPN_S2) throw new Error('ESPN credentials are required');

const wanted = new Set([1868367,1869694,1951644,1953735,1962369,1867957,2129297,1921396,1870431,1868359,1868405,1869693,1954423,1869892,1870428,2014162,1951343,1868992]);
const filter = JSON.stringify({ players: { limit: 4000, sortPercOwned: { sortPriority: 1, sortAsc: false } } });
const headers = {
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0',
  cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}`,
  'x-fantasy-filter': filter,
};

function unwrap(value) { return Array.isArray(value) && value.length === 1 ? value[0] : value; }

for (const view of ['kona_player_info', 'mDraftDetail&view=kona_player_info']) {
  const url = `${BASE}/leagueHistory/${LEAGUE_ID}?seasonId=2005&view=${view}`;
  const response = await fetch(url, { headers });
  const text = await response.text();
  console.log(`VIEW ${view} status=${response.status} bytes=${text.length}`);
  if (!response.ok) { console.log(text.slice(0, 500)); continue; }
  const data = unwrap(JSON.parse(text));
  const players = data?.players ?? [];
  console.log(`players=${players.length}`);
  for (const entry of players) {
    const p = entry?.player ?? entry;
    if (!wanted.has(Number(p?.id))) continue;
    console.log(JSON.stringify({ id: Number(p.id), fullName: p.fullName ?? null, defaultPositionId: p.defaultPositionId ?? null, proTeamId: p.proTeamId ?? null }));
  }
}
