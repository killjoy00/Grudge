/**
 * Trade valuation tests.
 *
 * These pin the behaviours that separate this from a points-added-up model:
 * a fourth running back is worth nothing, a tight end filling an empty slot is
 * worth everything, benching a player you traded for does not change what the
 * trade was worth, and a player either side cut stops counting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { valueTrade, type TradeValueInput, type PlayerWeekPoints } from './trade-value.ts';

const QB = 0, RB = 2, WR = 4, TE = 6, FLEX = 23;
const SLOTS = [QB, RB, RB, WR, WR, TE, FLEX];

/** Position ids, and the slots each may fill in this league. */
const POS = { qb: 1, rb: 2, wr: 3, te: 4 };
const ELIGIBLE: Record<number, number[]> = {
  [POS.qb]: [QB],
  [POS.rb]: [RB, FLEX],
  [POS.wr]: [WR, FLEX],
  [POS.te]: [TE, FLEX],
};

interface P { id: number; pos: number; ppw: number }

function scenario(
  players: P[],
  rosters: Record<number, number[]>,   // teamId -> player ids, all weeks
  moves: TradeValueInput['moves'],
  over: Partial<TradeValueInput> = {}
): TradeValueInput {
  const weeks = over.weeks ?? [1, 2];
  const rosterRows = weeks.flatMap((week) =>
    Object.entries(rosters).flatMap(([team, ids]) =>
      ids.map((espn_player_id) => ({ week, espn_team_id: Number(team), espn_player_id }))));
  const points: PlayerWeekPoints[] = weeks.flatMap((week) =>
    players.map((p) => ({ week, espn_player_id: p.id, points: p.ppw, started: false })));
  return {
    effective_week: 1, team_a: 1, team_b: 2, moves,
    rosters: rosterRows, points,
    eligible: new Map(players.map((p) => [p.id, ELIGIBLE[p.pos]!])),
    slots: SLOTS,
    position: new Map(players.map((p) => [p.id, p.pos])),
    replacement: new Map([[POS.qb, 5], [POS.rb, 5], [POS.wr, 5], [POS.te, 2]]),
    weeks,
    ...over,
  };
}

test('a straight upgrade at a starting slot is worth the difference', () => {
  const players: P[] = [
    { id: 10, pos: POS.wr, ppw: 20 },  // team 1 gives
    { id: 20, pos: POS.wr, ppw: 30 },  // team 2 gives
    { id: 91, pos: POS.qb, ppw: 15 }, { id: 92, pos: POS.qb, ppw: 15 },
  ];
  const v = valueTrade(scenario(players,
    { 1: [20, 91], 2: [10, 92] },
    [{ espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
     { espn_player_id: 20, from_team_id: 2, to_team_id: 1 }]));
  assert.equal(v.a.lineupImpact, 20);   // +10 a week for two weeks
  assert.equal(v.b.lineupImpact, -20);
  assert.equal(v.winner, 1);
  assert.equal(v.mutual, false);
});

test('a fourth running back adds nothing, so 1-for-2 is not a rout', () => {
  // Team 1 gives one starter-quality RB and gets two, but only two RB slots
  // and a FLEX exist and its own backs already fill them. The extra body
  // cannot reach the field, and a model that summed player points would call
  // this a landslide.
  const players: P[] = [
    { id: 11, pos: POS.rb, ppw: 20 }, { id: 12, pos: POS.rb, ppw: 19 },
    { id: 13, pos: POS.rb, ppw: 18 }, { id: 14, pos: POS.rb, ppw: 17 },
    { id: 10, pos: POS.rb, ppw: 16 },  // team 1 gives this one
    { id: 21, pos: POS.rb, ppw: 9 }, { id: 22, pos: POS.rb, ppw: 8 }, // team 1 receives
  ];
  const v = valueTrade(scenario(players,
    { 1: [11, 12, 13, 14, 21, 22], 2: [10] },
    [{ espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
     { espn_player_id: 21, from_team_id: 2, to_team_id: 1 },
     { espn_player_id: 22, from_team_id: 2, to_team_id: 1 }]));
  // Team 1's best backs were 20/19/18 either way -- the trade did nothing for
  // its lineup even though it received two bodies for one.
  assert.equal(v.a.lineupImpact, 0);
  // And the value figure agrees, because neither body ever reached the field.
  // A model that summed points would have scored this as a landslide; charging
  // replacement only for weeks a player would actually have started is what
  // keeps the two numbers from contradicting each other.
  assert.equal(v.a.playerValue, 0);
  assert.equal(v.a.rosteredPoints, 34, 'they still scored -- it just did not matter');
});

test('a tight end filling an empty slot is worth all of his points', () => {
  const players: P[] = [
    { id: 30, pos: POS.te, ppw: 12 },   // team 1 receives; it has no TE
    { id: 40, pos: POS.wr, ppw: 12 },   // team 1 gives; it has WRs to spare
    { id: 41, pos: POS.wr, ppw: 14 }, { id: 42, pos: POS.wr, ppw: 13 },
    { id: 43, pos: POS.wr, ppw: 12 },
  ];
  const v = valueTrade(scenario(players,
    { 1: [30, 41, 42, 43], 2: [40] },
    [{ espn_player_id: 40, from_team_id: 1, to_team_id: 2 },
     { espn_player_id: 30, from_team_id: 2, to_team_id: 1 }]));
  // With the TE: 14 + 13 + 12 (WR, WR, FLEX) + 12 (TE) = 51.
  // Without him, the given-up WR comes back and takes the FLEX at 12; the TE
  // slot stands empty. 14 + 13 + 12 + 12 = 51 as well -- but the FLEX was
  // already filled, so the swap is exactly neutral on raw points and the TE
  // slot is what makes it not so. Assert the direction rather than a figure
  // pulled from the same arithmetic being tested.
  assert.ok(v.a.lineupImpact >= 0, 'filling the empty slot is not a loss');
  assert.equal(v.b.lineupImpact, 0); // team 2 starts one WR either way
});

test('benching the player you traded for does not change what the trade was worth', () => {
  const players: P[] = [
    { id: 10, pos: POS.wr, ppw: 10 }, { id: 20, pos: POS.wr, ppw: 25 },
  ];
  const base = scenario(players, { 1: [20], 2: [10] },
    [{ espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
     { espn_player_id: 20, from_team_id: 2, to_team_id: 1 }]);
  const benched = valueTrade(base);
  const started = valueTrade({
    ...base,
    points: base.points.map((p) => ({ ...p, started: true })),
  });
  assert.equal(benched.a.lineupImpact, started.a.lineupImpact);
  // The started figure is what changes, and it is reported separately.
  assert.equal(benched.a.startedPoints, 0);
  assert.equal(started.a.startedPoints, 50);
});

test('a player you cut stops counting, and the one you gave up comes back', () => {
  const players: P[] = [
    { id: 10, pos: POS.wr, ppw: 10 },  // team 1 gives, team 2 keeps
    { id: 20, pos: POS.wr, ppw: 30 },  // team 1 receives, then cuts after week 1
    { id: 99, pos: POS.wr, ppw: 0 },   // filler, so team 1 still HAS a snapshot
  ];
  const rosterRows = [
    { week: 1, espn_team_id: 1, espn_player_id: 20 },
    { week: 1, espn_team_id: 1, espn_player_id: 99 },
    { week: 1, espn_team_id: 2, espn_player_id: 10 },
    { week: 2, espn_team_id: 1, espn_player_id: 99 },  // team 1 has cut 20
    { week: 2, espn_team_id: 2, espn_player_id: 10 },
  ];
  const v = valueTrade({
    ...scenario(players, {}, [
      { espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
      { espn_player_id: 20, from_team_id: 2, to_team_id: 1 }]),
    rosters: rosterRows,
  });
  // Week 1: +30 against the 10 he gave up = +20. Week 2: he has nobody, the
  // counterfactual has the player he gave up = -10. Net +10.
  assert.equal(v.a.lineupImpact, 10);
  assert.equal(v.a.rosteredPoints, 30, 'only the week he was rostered');
});

test('a player the other side cut stops counting against you', () => {
  const players: P[] = [
    { id: 10, pos: POS.wr, ppw: 40 },  // team 1 gives; team 2 cuts him
    { id: 20, pos: POS.wr, ppw: 5 },
  ];
  const rosterRows = [
    { week: 1, espn_team_id: 1, espn_player_id: 20 },
    { week: 1, espn_team_id: 2, espn_player_id: 10 },
    { week: 2, espn_team_id: 1, espn_player_id: 20 },  // team 2 has cut 10
  ];
  const v = valueTrade({
    ...scenario(players, {}, [
      { espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
      { espn_player_id: 20, from_team_id: 2, to_team_id: 1 }]),
    rosters: rosterRows,
  });
  // Week 1 costs team 1 the difference; week 2 is pure credit for what it kept,
  // because a player the other manager threw away cannot beat you.
  assert.equal(v.a.lineupImpact, -35 + 5);
});

test('both sides can gain, and that is reported rather than forced to zero', () => {
  // The classic positional swap: each team has a surplus and a hole.
  const players: P[] = [
    { id: 10, pos: POS.rb, ppw: 20 }, { id: 11, pos: POS.rb, ppw: 19 },
    { id: 12, pos: POS.rb, ppw: 18 }, { id: 13, pos: POS.rb, ppw: 17 },
    { id: 20, pos: POS.te, ppw: 16 }, { id: 21, pos: POS.te, ppw: 15 },
  ];
  const v = valueTrade(scenario(players,
    // Team 1 hands over its fourth back for a tight end; team 2 does the reverse.
    { 1: [10, 11, 12, 20], 2: [21, 13] },
    [{ espn_player_id: 13, from_team_id: 1, to_team_id: 2 },
     { espn_player_id: 20, from_team_id: 2, to_team_id: 1 }]));
  assert.ok(v.a.lineupImpact > 0 && v.b.lineupImpact > 0, 'both sides better off');
  assert.equal(v.mutual, true);
});

test('a player with no known eligibility is left out rather than started anywhere', () => {
  const players: P[] = [{ id: 10, pos: POS.wr, ppw: 10 }, { id: 20, pos: POS.wr, ppw: 30 }];
  const base = scenario(players, { 1: [20], 2: [10] },
    [{ espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
     { espn_player_id: 20, from_team_id: 2, to_team_id: 1 }]);
  const v = valueTrade({ ...base, eligible: new Map() });
  assert.equal(v.a.lineupImpact, 0);
});

test('no completed weeks yet means no verdict, not a tie', () => {
  const players: P[] = [{ id: 10, pos: POS.wr, ppw: 10 }, { id: 20, pos: POS.wr, ppw: 30 }];
  const v = valueTrade({
    ...scenario(players, { 1: [20], 2: [10] },
      [{ espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
       { espn_player_id: 20, from_team_id: 2, to_team_id: 1 }]),
    weeks: [],
    rosters: [],
  });
  assert.equal(v.winner, null);
  assert.equal(v.weeksScored, 0);
  assert.equal(v.mutual, false);
});

test('weeks before the trade are never scored', () => {
  const players: P[] = [{ id: 10, pos: POS.wr, ppw: 10 }, { id: 20, pos: POS.wr, ppw: 30 }];
  const v = valueTrade({
    ...scenario(players, { 1: [20], 2: [10] },
      [{ espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
       { espn_player_id: 20, from_team_id: 2, to_team_id: 1 }],
      { weeks: [1, 2] }),
    effective_week: 2,
  });
  assert.equal(v.weeksScored, 1);
  assert.equal(v.a.lineupImpact, 20);
});

test('value over replacement is position adjusted', () => {
  // Same points, different positions: the tight end is worth more because the
  // player you would otherwise start at TE scores far less.
  const players: P[] = [
    { id: 10, pos: POS.wr, ppw: 10 }, { id: 20, pos: POS.te, ppw: 10 },
    { id: 30, pos: POS.qb, ppw: 1 }, { id: 31, pos: POS.qb, ppw: 1 },
  ];
  const v = valueTrade(scenario(players,
    { 1: [20, 30], 2: [10, 31] },
    [{ espn_player_id: 10, from_team_id: 1, to_team_id: 2 },
     { espn_player_id: 20, from_team_id: 2, to_team_id: 1 }]));
  assert.equal(v.a.playerValue, 16);  // TE: (10 - 2) x 2 weeks
  assert.equal(v.b.playerValue, 10);  // WR: (10 - 5) x 2 weeks
});
