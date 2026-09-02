/**
 * Trade grading tests.
 *
 * The rules being pinned are the ones a manager will argue about: bench points
 * do not decide a trade, points scored before the trade never count, a trade
 * with no games played yet has no verdict, and the all-time table ranks on
 * points rather than on a win-loss line that flattens a blowout into a tick.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  gradeTrade, franchiseTradeRecords,
  type AcquiredPoints, type GradedTrade,
} from './trade-grade.ts';

const TRADE = { trade_id: 't1', team_a: 3, team_b: 5 };

const got = (
  to_team_id: number, espn_player_id: number,
  starter_points: number, total_points = starter_points, weeks_rostered = 4
): AcquiredPoints => ({
  trade_id: 't1', espn_player_id, to_team_id, starter_points, total_points, weeks_rostered,
});

test('the side whose acquisition scored more wins', () => {
  const g = gradeTrade(TRADE, [got(3, 200, 90), got(5, 100, 60)]);
  assert.equal(g.winner, 3);
  assert.equal(g.margin, 30);
  assert.equal(g.verdict, 'graded');
});

test('bench points do not decide the trade', () => {
  // Team 5 got the higher scorer and started him less. The headline follows
  // starter points; total points still records what the player did.
  const g = gradeTrade(TRADE, [got(3, 200, 90, 90), got(5, 100, 60, 140)]);
  assert.equal(g.winner, 3);
  assert.equal(g.b.totalPoints, 140);
  assert.equal(g.b.starterPoints, 60);
});

test('an exact tie is even, with no winner named', () => {
  const g = gradeTrade(TRADE, [got(3, 200, 75), got(5, 100, 75)]);
  assert.equal(g.winner, null);
  assert.equal(g.verdict, 'even');
});

test('a trade with no week played yet is ungraded, not a 0-0 tie', () => {
  const g = gradeTrade(TRADE, [got(3, 200, 0, 0, 0), got(5, 100, 0, 0, 0)]);
  assert.equal(g.verdict, 'ungraded');
  assert.equal(g.winner, null);
});

test('an empty acquisition list is ungraded rather than a crash', () => {
  const g = gradeTrade(TRADE, []);
  assert.equal(g.verdict, 'ungraded');
  assert.equal(g.weeksScored, 0);
});

test('two players for one is scored on points, not headcount', () => {
  const g = gradeTrade(TRADE, [got(3, 200, 40), got(3, 201, 40), got(5, 100, 95)]);
  assert.equal(g.winner, 5);
  assert.equal(g.a.starterPoints, 80);
});

test('another trade\'s rows are ignored', () => {
  const other: AcquiredPoints = { ...got(5, 999, 500), trade_id: 't2' };
  const g = gradeTrade(TRADE, [got(3, 200, 90), got(5, 100, 60), other]);
  assert.equal(g.winner, 3);
  assert.equal(g.b.starterPoints, 60);
});

/* ------------------------------------------------------- all-time records */

const graded: GradedTrade[] = [
  gradeTrade({ trade_id: 't1', team_a: 3, team_b: 5 }, [got(3, 200, 90), got(5, 100, 60)]),
  gradeTrade({ trade_id: 't2', team_a: 3, team_b: 9 },
    [{ ...got(3, 300, 10), trade_id: 't2' }, { ...got(9, 301, 12), trade_id: 't2' }]),
];
const names: Record<number, string> = { 3: 'Nightmares', 5: 'Panda', 9: 'Nannies' };
const franchise = (_s: number, teamId: number) =>
  ({ key: `f${teamId}`, name: names[teamId]! });
const seasonOf = () => 2026;

test('net points rank the table, and both sides of a trade are counted', () => {
  const rows = franchiseTradeRecords(graded, franchise, seasonOf);
  assert.deepEqual(rows.map((r) => [r.name, r.net, r.won, r.lost]), [
    ['Nightmares', 28, 1, 1],   // +30 on t1, -2 on t2
    ['Nannies', 2, 1, 0],
    ['Panda', -30, 0, 1],
  ]);
  assert.equal(rows[0]!.trades, 2);
});

test('an ungraded trade counts as a trade but scores nothing', () => {
  const pending = gradeTrade({ trade_id: 't3', team_a: 3, team_b: 5 }, []);
  const rows = franchiseTradeRecords([...graded, pending], franchise, seasonOf);
  const nightmares = rows.find((r) => r.name === 'Nightmares')!;
  assert.equal(nightmares.trades, 3);
  assert.equal(nightmares.net, 28); // unchanged by the pending trade
  assert.equal(nightmares.won + nightmares.lost + nightmares.even, 2);
});

test('a franchise that cannot be resolved is dropped, not credited to a blank', () => {
  const rows = franchiseTradeRecords(graded, (_s, id) =>
    id === 5 ? null : { key: `f${id}`, name: names[id]! }, seasonOf);
  assert.deepEqual(rows.map((r) => r.name), ['Nightmares', 'Nannies']);
});
