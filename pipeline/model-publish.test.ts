import { test } from 'node:test';
import assert from 'node:assert/strict';

import { draftPublicationStatements } from './model-publish.ts';
import { canonicalPlayerKey } from './player-week.ts';
import type { DraftPerformanceSeason } from './draft-model.ts';
import { execute, modelDatabase } from '../tests/models/database.ts';

function syntheticSeason(season: number, fantasyPoints: number): DraftPerformanceSeason {
  return {
    season,
    regular_weeks: 13,
    team_count: 1,
    total_picks: 1,
    board: [[1, 1, 8417]],
    slot_counts: { '2': 1 },
    pool: [
      [`qb-${season}`, 1, 100],
      [`rb-top-${season}`, 2, 200],
      [`rb-replacement-${season}`, 2, 50],
      [`wr-${season}`, 3, 100],
      [`te-${season}`, 4, 100],
    ],
    picks: [{
      overall_pick: 1,
      espn_team_id: 1,
      espn_player_id: 8417,
      full_name: 'Ronnie Brown',
      position: 2,
      fantasy_points: fantasyPoints,
      active_weeks: 10,
      performance_source: 'nflverse',
    }],
  };
}

test('draft publication carries the committed canonical key before a season alias exists in Postgres', async () => {
  const db = await modelDatabase();
  try {
    const playerKey = canonicalPlayerKey(8417);
    assert.notEqual(playerKey, 'espn:8417', 'fixture must exercise a recovered canonical identity');
    await db.query(
      `insert into nfl_players(player_key, full_name, position, bio) values ($1, 'Ronnie Brown', 'RB', '{}')`,
      [playerKey],
    );

    // Four seasons provide the model's minimum three out-of-season benchmarks.
    // Deliberately do not insert nfl_player_aliases: a newly recovered season may
    // be published before that provider crosswalk has ever existed in production.
    const seasons = [
      syntheticSeason(2007, 150),
      syntheticSeason(2008, 160),
      syntheticSeason(2009, 170),
      syntheticSeason(2010, 180),
    ];
    const coverage = Object.fromEntries(seasons.map(({ season }) => [season, {
      ready: true,
      reasons: [],
      source_hash: `season-${season}`,
    }]));

    await execute(db, draftPublicationStatements(seasons, coverage));

    const published = await db.query<{ season: number; player_key: string; result_player_key: string }>(`
      select season, player_key, result->>'player_key' as result_player_key
        from draft_grade_results
       order by season
    `);
    assert.equal(published.rows.length, 4);
    assert.deepEqual(published.rows.map((row) => row.player_key), Array(4).fill(playerKey));
    assert.deepEqual(published.rows.map((row) => row.result_player_key), Array(4).fill(playerKey));
    const aliases = await db.query<{ n: number }>('select count(*)::int as n from nfl_player_aliases');
    assert.equal(aliases.rows[0]?.n, 0);
  } finally {
    await db.close();
  }
});
