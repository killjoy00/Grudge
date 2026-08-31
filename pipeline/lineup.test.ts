/**
 * Tests for the exact lineup solver.
 *
 * The important one is the randomised comparison against brute force. An
 * assignment solver that is subtly wrong does not crash -- it returns a
 * plausible number, which then becomes plausible trade advice. Brute force is
 * obviously correct and hopelessly slow; the fast solver has to agree with it
 * on every one of a few hundred random rosters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bestLineup, bestLineupBruteForce, expandSlots, type LineupPlayer } from './lineup.ts';

// This league, derived in Step 1 by inverting eligibleSlots over 502 real
// player-rows -- not taken from a table of ESPN slot ids.
const SLOT_ELIGIBLE: Record<number, number[]> = {
  0: [1],           // QB
  2: [2],           // RB
  4: [3],           // WR
  5: [3, 4],        // WR/TE
  6: [4],           // TE
  16: [16],         // D/ST
  17: [5],          // K
  23: [2, 3, 4],    // FLEX: RB/WR/TE
};
const CAPACITY = new Map([[0, 1], [2, 2], [4, 2], [5, 1], [6, 1], [16, 1], [17, 1], [23, 1]]);

function slotsForPosition(pos: number): number[] {
  return Object.entries(SLOT_ELIGIBLE)
    .filter(([, ps]) => ps.includes(pos))
    .map(([s]) => Number(s));
}

test('expandSlots turns capacities into individual openings', () => {
  const slots = expandSlots(CAPACITY);
  assert.equal(slots.length, 10, 'this league starts 10');
  assert.equal(slots.filter((s) => s === 2).length, 2, 'two RB slots');
  assert.equal(slots.filter((s) => s === 4).length, 2, 'two WR slots');
});

test('a straightforward roster fills every slot with its best option', () => {
  const players: LineupPlayer[] = [
    { id: 1, points: 25, eligible: slotsForPosition(1) },  // QB
    { id: 2, points: 20, eligible: slotsForPosition(2) },  // RB
    { id: 3, points: 18, eligible: slotsForPosition(2) },  // RB
    { id: 4, points: 15, eligible: slotsForPosition(3) },  // WR
    { id: 5, points: 14, eligible: slotsForPosition(3) },  // WR
    { id: 6, points: 12, eligible: slotsForPosition(3) },  // WR -> WR/TE
    { id: 7, points: 10, eligible: slotsForPosition(4) },  // TE
    { id: 8, points: 9,  eligible: slotsForPosition(2) },  // RB -> FLEX
    { id: 9, points: 8,  eligible: slotsForPosition(16) }, // D/ST
    { id: 10, points: 7, eligible: slotsForPosition(5) },  // K
  ];
  const result = bestLineup(players, expandSlots(CAPACITY));
  assert.equal(result.total, 138);
  assert.equal(result.assignment.length, 10);
});

test('the greedy trap: a scarce slot must not be robbed by a flex', () => {
  // One TE on the roster and both a TE slot and a WR/TE slot open. A solver
  // that fills WR/TE first with the TE leaves the TE slot empty and loses
  // points. The exact answer starts the TE at TE and the WR at WR/TE.
  const players: LineupPlayer[] = [
    { id: 1, points: 20, eligible: [5, 6] },  // TE, eligible for TE and WR/TE
    { id: 2, points: 18, eligible: [4, 5, 23] }, // WR
  ];
  const slots = [6, 5]; // TE, WR/TE
  const result = bestLineup(players, slots);
  assert.equal(result.total, 38, 'both slots filled, nothing stranded');
});

test('unfillable slots are left empty rather than filled illegally', () => {
  const players: LineupPlayer[] = [{ id: 1, points: 20, eligible: [0] }];
  const result = bestLineup(players, [0, 16, 17]); // no D/ST, no K on the roster
  assert.equal(result.total, 20);
  assert.equal(result.assignment.length, 1);
  assert.ok(result.assignment.every((a) => a.slot === 0));
});

test('empty inputs are zero, not a crash', () => {
  assert.equal(bestLineup([], expandSlots(CAPACITY)).total, 0);
  assert.equal(bestLineup([{ id: 1, points: 5, eligible: [0] }], []).total, 0);
});

test('matches brute force on 300 random rosters', () => {
  // Deterministic RNG so a failure is reproducible from the seed alone.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5;  seed >>>= 0;
    return seed / 0x100000000;
  };

  const positions = [1, 2, 3, 4, 5, 16];
  for (let trial = 0; trial < 300; trial++) {
    // Small slot sets keep brute force tractable while still covering the
    // multi-eligibility cases that make the problem non-trivial.
    const slotPool = [0, 2, 2, 4, 4, 5, 6, 23];
    const slots = slotPool.slice(0, 3 + Math.floor(rand() * 5));

    const n = 1 + Math.floor(rand() * 7);
    const players: LineupPlayer[] = [];
    for (let i = 0; i < n; i++) {
      const pos = positions[Math.floor(rand() * positions.length)]!;
      // Range deliberately spans zero. The first version of this test drew only
      // non-negative points, so leaving a slot empty never won and a solver
      // that could not leave one empty passed 300/300 while being wrong.
      players.push({
        id: i,
        points: Math.round((rand() * 320 - 20)) / 10,
        eligible: slotsForPosition(pos),
      });
    }

    const fast = bestLineup(players, slots).total;
    const slow = bestLineupBruteForce(players, slots);
    assert.ok(
      Math.abs(fast - slow) < 1e-6,
      `trial ${trial}: solver said ${fast}, brute force ${slow}\n` +
        `slots=${JSON.stringify(slots)}\nplayers=${JSON.stringify(players)}`
    );
  }
});

test('negative scores are handled -- a slot is better left empty', () => {
  // D/ST and kickers can genuinely score below zero. Starting one when the slot
  // could stay empty costs points, and the solver must see that.
  const players: LineupPlayer[] = [{ id: 1, points: -4, eligible: [16] }];
  const result = bestLineup(players, [16]);
  assert.equal(result.total, 0, 'a negative player should not be started');
  assert.equal(result.assignment.length, 0);
});
