import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import type { EspnLeague } from '../pipeline/espn.ts';
import { MODEL_VERSION } from '../pipeline/features.ts';
import { buildScoreDerivedSeason } from '../scripts/backfill-score-derived-history.ts';

function league(season: number): EspnLeague {
  const raw = gunzipSync(readFileSync(new URL(`../data/history/${season}/league.json.gz`, import.meta.url)));
  return JSON.parse(raw.toString()) as EspnLeague;
}

test('2005 recovered scores support the full current power model', () => {
  const built = buildScoreDerivedSeason(2005, league(2005));
  assert.deepEqual(built.summary, {
    teams: 8,
    weeks: 12,
    team_week_results: 96,
    luck_index: 96,
    power_rankings: 96,
  });
  const powerStatements = built.statements.filter((statement) => statement.text.includes('public.power_rankings'));
  assert.ok(powerStatements.length > 0);
  assert.ok(powerStatements.some((statement) => statement.params.includes(MODEL_VERSION)));
});

test('2017 recovered scores support 13 full regular-season weeks', () => {
  const built = buildScoreDerivedSeason(2017, league(2017));
  assert.equal(built.summary.teams, 10);
  assert.equal(built.summary.weeks, 13);
  assert.equal(built.summary.team_week_results, 130);
  assert.equal(built.summary.luck_index, 130);
  assert.equal(built.summary.power_rankings, 130);
});
