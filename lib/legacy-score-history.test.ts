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

test('every recovered 2005-2017 season supports the full current power model', () => {
  for (let season = 2005; season <= 2017; season += 1) {
    const built = buildScoreDerivedSeason(season, league(season));
    const teams = season === 2005 ? 8 : 10;
    const weeks = season === 2005 ? 12 : 13;
    const rows = teams * weeks;
    assert.deepEqual(built.summary, {
      teams,
      weeks,
      team_week_results: rows,
      luck_index: rows,
      power_rankings: rows,
    }, `${season} derived-row coverage`);

    const powerStatements = built.statements.filter((statement) => statement.text.includes('public.power_rankings'));
    assert.ok(powerStatements.length > 0, `${season} has a power upsert`);
    assert.ok(
      powerStatements.some((statement) => statement.params.includes(MODEL_VERSION)),
      `${season} uses ${MODEL_VERSION}`
    );
  }
});

test('score-only history leaves lineup-specific columns null', () => {
  const built = buildScoreDerivedSeason(2005, league(2005));
  const teamWeek = built.statements.find((statement) => statement.text.includes('public.team_week_results'))!;
  assert.match(teamWeek.text, /optimal_points/);
  // There is no legacy roster payload to feed these columns. The generated
  // parameter list must therefore contain nulls rather than invented values.
  assert.ok(teamWeek.params.some((value) => value === null));
});
