import assert from 'node:assert/strict';
import test from 'node:test';

import { isTrackedPlayoffTier, trackedMatchupSql } from './playoff-policy.ts';

test('regular season and championship bracket are tracked', () => {
  assert.equal(isTrackedPlayoffTier(null), true);
  assert.equal(isTrackedPlayoffTier(undefined), true);
  assert.equal(isTrackedPlayoffTier('NONE'), true);
  assert.equal(isTrackedPlayoffTier('WINNERS_BRACKET'), true);
});

test('all consolation/lower brackets are excluded', () => {
  assert.equal(isTrackedPlayoffTier('LOSERS_CONSOLATION_LADDER'), false);
  assert.equal(isTrackedPlayoffTier('CONSOLATION_LADDER'), false);
  assert.equal(isTrackedPlayoffTier('LOSERS_BRACKET'), false);
});

test('SQL policy mirrors the same rule', () => {
  assert.match(trackedMatchupSql('x'), /x\.playoff_tier is null/);
  assert.match(trackedMatchupSql('x'), /'NONE'/);
  assert.match(trackedMatchupSql('x'), /'WINNERS_BRACKET'/);
});
