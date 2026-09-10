#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { connect } from '../pipeline/db.ts';

const bases = JSON.parse(readFileSync(new URL('../data/derived/draft-performance.json', import.meta.url), 'utf8')).seasons;
const expected = new Map();
for (const season of bases) for (const pick of season.picks) {
  const key = `${season.season}:${pick.espn_player_id}`;
  const prior = expected.get(key);
  if (prior && prior !== pick.player_key) throw new Error(`${key}: committed draft evidence has two canonical keys`);
  expected.set(key, pick.player_key);
}
const sql = connect();
const rows = await sql.query(
  'select season, espn_player_id, player_key from public.nfl_player_aliases where season = any($1::int[]) order by season, espn_player_id',
  [bases.map((season) => season.season)],
);
const conflicts = rows.filter((row) => {
  const wanted = expected.get(`${row.season}:${row.espn_player_id}`);
  return wanted && wanted !== row.player_key;
}).map((row) => ({ ...row, expected: expected.get(`${row.season}:${row.espn_player_id}`) }));
console.log(`Checked ${expected.size} reviewed draft aliases against ${rows.length} existing season aliases; conflicts=${conflicts.length}`);
if (conflicts.length) {
  for (const conflict of conflicts) console.error(JSON.stringify(conflict));
  process.exitCode = 1;
}
