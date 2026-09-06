import { test } from 'node:test';
import assert from 'node:assert/strict';

import { valueTradeProduction } from './trade-production.ts';

const WR = 3;

function base() {
  return {
    effective_week: 1,
    team_a: 1,
    team_b: 2,
    moves: [
      { espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
      { espn_player_id: 20, from_team_id: 2, to_team_id: 1 },
    ],
    rosters: [
      { week: 1, espn_team_id: 1, espn_player_id: 20 },
      { week: 1, espn_team_id: 1, espn_player_id: 99 },
      { week: 1, espn_team_id: 2, espn_player_id: 10 },
      { week: 2, espn_team_id: 1, espn_player_id: 20 },
      { week: 2, espn_team_id: 1, espn_player_id: 99 },
      { week: 2, espn_team_id: 2, espn_player_id: 10 },
    ],
    points: [
      { week: 1, espn_player_id: 20, points: 18, started: false },
      { week: 2, espn_player_id: 20, points: 18, started: false },
      { week: 1, espn_player_id: 99, points: 30, started: true },
      { week: 2, espn_player_id: 99, points: 30, started: true },
      { week: 1, espn_player_id: 10, points: 8, started: true },
      { week: 2, espn_player_id: 10, points: 8, started: true },
    ],
    position: new Map([[10, WR], [20, WR], [99, WR]]),
    replacement: new Map([[WR, 5]]),
    weeks: [1, 2],
  };
}

test('player value ignores whether a better teammate blocks the acquisition', () => {
  const value = valueTradeProduction(base());
  assert.equal(value.a.value, 26, '18 points minus 5-point baseline, twice');
  assert.equal(value.a.playerWeeks, 2);
  assert.equal(value.b.value, 6, '8 points minus 5-point baseline, twice');
  assert.equal(value.winner, 1);
  assert.equal(value.margin, 20);
});

test('an acquired player stops accumulating value after he leaves the roster', () => {
  const input = base();
  input.rosters = input.rosters.filter((row) => !(row.week === 2 && row.espn_team_id === 1 && row.espn_player_id === 20));
  const value = valueTradeProduction(input);
  assert.equal(value.a.value, 13);
  assert.equal(value.a.playerWeeks, 1);
});

test('a zero-point owned week is below replacement, not silently ignored', () => {
  const input = base();
  input.points = input.points.map((row) => row.espn_player_id === 20 ? { ...row, points: 0 } : row);
  const value = valueTradeProduction(input);
  assert.equal(value.a.value, -10);
});
