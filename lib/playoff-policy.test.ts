import assert from 'node:assert/strict';
import test from 'node:test';

import { isTrackedGame, trackedMatchupSql } from './playoff-policy.ts';

test('every game through the regular-season boundary is tracked', () => {
  assert.equal(isTrackedGame(14, 14, null), true);
  assert.equal(isTrackedGame(14, 14, 'NONE'), true);
});

test('after the regular season only the championship bracket is tracked', () => {
  assert.equal(isTrackedGame(15, 14, 'WINNERS_BRACKET'), true);
  assert.equal(isTrackedGame(15, 14, null), false);
  assert.equal(isTrackedGame(15, 14, 'NONE'), false);
  assert.equal(isTrackedGame(15, 14, 'LOSERS_CONSOLATION_LADDER'), false);
  assert.equal(isTrackedGame(17, 14, 'CONSOLATION_LADDER'), false);
});

test('SQL policy enforces both season boundary and explicit winners bracket', () => {
  const sql = trackedMatchupSql('x');
  assert.match(sql, /public\.seasons/);
  assert.match(sql, /x\.week <= tracked_season\.regular_season_weeks/);
  assert.match(sql, /x\.playoff_tier = 'WINNERS_BRACKET'/);
  assert.doesNotMatch(sql, /playoff_tier is null/);
});
