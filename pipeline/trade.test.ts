/**
 * Tests for the trade value model.
 *
 * Run against the seven real archived seasons where possible. The properties
 * asserted here are the ones whose failure would produce advice that looks
 * authoritative and is wrong -- which is the specific failure this model exists
 * to avoid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  starterDemand, replacementLevels, shrunkPpg, valueOverReplacement,
  rosterStrength, evaluateTrade, findTrades, type PlayerSeason,
} from './trade.ts';
import { expandSlots } from './lineup.ts';

/* This league, all measured in Step 1 / from the archive -- see trade.ts. */
const CAPACITY = new Map([[0, 1], [2, 2], [4, 2], [5, 1], [6, 1], [16, 1], [17, 1], [23, 1]]);
const SLOT_POSITIONS = new Map([
  [0, [1]], [2, [2]], [4, [3]], [5, [3, 4]], [6, [4]], [16, [16]], [17, [5]], [23, [2, 3, 4]],
]);
/** Observed fill over 7 seasons: WR/TE ran 93.5% WR; FLEX ran 66.8/30.9/2.3. */
const OBSERVED = new Map([
  [5, new Map([[3, 635], [4, 44]])],
  [23, new Map([[2, 782], [3, 361], [4, 27]])],
]);
const SLOTS = expandSlots(CAPACITY);

function player(id: number, positionId: number, ppg: number, games = 17): PlayerSeason {
  const eligible = [...SLOT_POSITIONS].filter(([, ps]) => ps.includes(positionId)).map(([s]) => s);
  return { playerId: id, name: `P${id}`, positionId, eligible, ppg, games };
}

test('starter demand accounts for every opening exactly once', () => {
  const demand = starterDemand(CAPACITY, SLOT_POSITIONS, OBSERVED, 10);
  const total = [...demand.values()].reduce((a, b) => a + b, 0);
  // 10 starters x 10 teams. If flex apportionment double-counted or dropped an
  // opening, every replacement level would shift.
  assert.ok(Math.abs(total - 100) < 1e-6, `demand totals ${total}, expected 100`);
});

test('flex demand follows observed fill, not an even split', () => {
  const demand = starterDemand(CAPACITY, SLOT_POSITIONS, OBSERVED, 10);
  // RB: 2 dedicated x10 = 20, plus 66.8% of the 10 FLEX openings.
  assert.ok(Math.abs(demand.get(2)! - 26.68) < 0.1, `RB demand ${demand.get(2)}`);
  // TE: 1 dedicated x10, plus small shares of WR/TE and FLEX.
  assert.ok(demand.get(4)! > 10 && demand.get(4)! < 12, `TE demand ${demand.get(4)}`);
  // An even split would have given TE 10 + 5 + 3.3 = 18.3.
  assert.ok(demand.get(4)! < 13, 'TE must not get an even share of the flex slots');
});

test('an unobserved multi-position slot splits evenly rather than silently guessing', () => {
  const demand = starterDemand(
    new Map([[23, 1]]), new Map([[23, [2, 3, 4]]]), new Map(), 10
  );
  for (const pos of [2, 3, 4]) {
    assert.ok(Math.abs(demand.get(pos)! - 10 / 3) < 1e-6, `pos ${pos} should get an even third`);
  }
});

test('REGRESSION: a one-week wonder must not set the replacement level', () => {
  // The bug this catches, verbatim from 2025: ranking on raw ppg made Emanuel
  // Wilson the best RB in the league on 25.50 points in a single game, ahead of
  // Christian McCaffrey's 356.9 across 17.
  const players = [
    player(1, 2, 25.5, 1),   // the one-week wonder
    ...Array.from({ length: 40 }, (_, i) => player(100 + i, 2, 20 - i * 0.4, 17)),
  ];
  const demand = new Map([[2, 26.68]]);
  const levels = replacementLevels(players, demand);

  const ranked = [...players].sort(
    (a, b) => shrunkPpg(b, levels.get(2)!) - shrunkPpg(a, levels.get(2)!)
  );
  assert.notEqual(ranked[0]!.playerId, 1, 'the 1-game player must not rank first');
  assert.ok(ranked[0]!.games >= 10, 'the top-ranked RB should have a real sample');
});

test('shrinkage pulls toward replacement, so unproven means ordinary', () => {
  const replacement = 10;
  const hot = { ...player(1, 2, 30, 1) };
  const proven = { ...player(2, 2, 30, 17) };
  assert.ok(shrunkPpg(hot, replacement) < shrunkPpg(proven, replacement));
  // One game at 30 must land nearer replacement than the raw figure.
  assert.ok(shrunkPpg(hot, replacement) < 20);
  // A zero-game player IS replacement level -- not zero, which would make him
  // look actively harmful, and not his raw average, which does not exist.
  assert.equal(shrunkPpg({ ...player(3, 2, 99, 0) }, replacement), replacement);
});

test('value over replacement is zero at the line and negative below it', () => {
  const levels = new Map([[2, 10]]);
  assert.ok(Math.abs(valueOverReplacement(player(1, 2, 10, 99), levels)) < 0.2);
  assert.ok(valueOverReplacement(player(2, 2, 4, 99), levels) < 0, 'below replacement is negative');
  assert.ok(valueOverReplacement(player(3, 2, 20, 99), levels) > 0);
});

test('roster strength is the best LINEUP, not the sum of the roster', () => {
  const levels = new Map([[1, 8], [2, 8], [3, 8], [4, 6], [5, 6], [16, 5]]);
  // Six good WRs, but only ~5 WR-capable slots exist. The sixth cannot start,
  // so he must add nothing. Summing player values would count him in full.
  const five = [1, 2, 3, 4, 5].map((i) => player(i, 3, 15));
  const six = [...five, player(6, 3, 15)];
  assert.equal(
    rosterStrength(six, levels, SLOTS),
    rosterStrength(five, levels, SLOTS),
    'a player who cannot crack the lineup adds zero'
  );
});

test('a trade can raise total roster value while lowering points scored', () => {
  // The exact mistake naive tools make. This team has one TE. Trading him for a
  // better WR raises the summed value but empties the TE slot, so the lineup
  // gets worse -- and the model must report the loss.
  const levels = new Map([[1, 8], [2, 8], [3, 8], [4, 5], [5, 6], [16, 5]]);
  const roster = [
    player(1, 1, 20), player(2, 2, 15), player(3, 2, 14),
    player(4, 3, 13), player(5, 3, 12), player(6, 3, 11),
    player(7, 4, 9),  // the only TE
    player(8, 5, 8), player(9, 16, 7),
  ];
  const other = [player(20, 3, 18), player(21, 4, 9), player(22, 2, 12)];

  const v = evaluateTrade(
    { teamId: 1, roster, gives: [7] },       // gives away the only TE
    { teamId: 2, roster: other, gives: [20] }, // for a better WR
    levels, SLOTS
  );
  // The WR is worth more than the TE in raw points, so a summing model would
  // call this a clear win.
  assert.ok(18 > 9, 'premise: the incoming WR outscores the outgoing TE');
  assert.ok(
    v.a.delta < 18 - 9,
    'the lineup-based verdict must be smaller than the raw points swap'
  );
});

test('findTrades returns only mutually beneficial trades', () => {
  const levels = new Map([[1, 8], [2, 8], [3, 8], [4, 5], [5, 6], [16, 5]]);
  // A is deep at RB and has no TE; B is deep at TE and thin at RB. The
  // complementary trade should exist and help both.
  const a = [
    player(1, 1, 20), player(2, 2, 18), player(3, 2, 17), player(4, 2, 16),
    player(5, 3, 12), player(6, 3, 11), player(7, 4, 4), player(8, 5, 8), player(9, 16, 7),
  ];
  const b = [
    player(11, 1, 19), player(12, 2, 6), player(13, 3, 12), player(14, 3, 11),
    player(15, 4, 14), player(16, 4, 13), player(17, 5, 8), player(18, 16, 7),
  ];
  const found = findTrades(new Map([[1, a], [2, b]]), levels, SLOTS);

  for (const t of found) {
    assert.ok(t.aDelta > 0 && t.bDelta > 0, 'every suggestion must help both sides');
    assert.equal(t.fairness, Math.min(t.aDelta, t.bDelta));
  }
  // Sorted by the smaller gain, so the most acceptable trade leads.
  for (let i = 1; i < found.length; i++) {
    assert.ok(found[i - 1]!.fairness >= found[i]!.fairness, 'sorted by fairness');
  }
});

test('no mutually beneficial trade yields an empty list, not a bad suggestion', () => {
  const levels = new Map([[1, 8], [2, 8], [3, 8], [4, 5], [5, 6], [16, 5]]);
  // Two identical rosters. There is nothing to gain, and the honest answer is
  // nothing -- not the least-bad pairing dressed up as a recommendation.
  const roster = () => [
    player(1, 1, 20), player(2, 2, 15), player(3, 2, 14), player(4, 3, 13),
    player(5, 3, 12), player(6, 4, 9), player(7, 5, 8), player(8, 16, 7),
  ];
  const a = roster();
  const b = roster().map((p) => ({ ...p, playerId: p.playerId + 100 }));
  assert.deepEqual(findTrades(new Map([[1, a], [2, b]]), levels, SLOTS), []);
});
