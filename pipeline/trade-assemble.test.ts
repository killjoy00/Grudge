/**
 * Assembly tests for the trade board.
 *
 * The model itself is tested in trade.test.ts against real archives. What is
 * asserted here is the layer between the database and that model: the refusal
 * floor, slot capacity derived from observed lineups, and the exclusions that
 * stop a player who cannot be started from being offered in a trade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTradeReport, capacityFromStarters,
  type ScoringRow, type TradeInputs,
} from './trade-assemble.ts';
import { MIN_WEEKS_DEFAULT } from './trade.ts';

const QB = 0, RB = 2, WR = 4, FLEX = 23, K = 17, BENCH = 20;

const player = (
  id: number, name: string, pos: number, eligible: number[], ppg: number, games = 4
): ScoringRow => ({
  espn_player_id: id, full_name: name, default_position_id: pos,
  eligible_slots: eligible, total: String(ppg * games), games,
});

function inputs(over: Partial<TradeInputs> = {}): TradeInputs {
  return {
    season: 2026, weeks: 4, throughWeek: 4,
    scoring: [], fills: [], latest: [],
    capacity: new Map([[QB, 1], [RB, 2], [WR, 2], [FLEX, 1], [K, 1]]),
    teams: new Map([[1, 'Alpha'], [2, 'Beta']]),
    ...over,
  };
}

test('the model refuses below the minimum sample, and says how short it is', () => {
  const short = buildTradeReport(inputs({ weeks: MIN_WEEKS_DEFAULT - 1 }));
  assert.equal(short.ok, false);
  if (short.ok) return;
  assert.equal(short.refusal.required, MIN_WEEKS_DEFAULT);
  assert.equal(short.refusal.weeks, MIN_WEEKS_DEFAULT - 1);

  // And speaks at exactly the floor -- the boundary, not one past it.
  const atFloor = buildTradeReport(inputs({ weeks: MIN_WEEKS_DEFAULT }));
  assert.equal(atFloor.ok, true);
});

test('the floor is two weeks', () => {
  // Pinned deliberately: this was lowered from four on request, and a silent
  // drift back would change what the board is willing to claim.
  assert.equal(MIN_WEEKS_DEFAULT, 2);
});

test('slot capacity comes from the fullest lineup anyone actually set', () => {
  // Two RBs and one FLEX started in week 1; week 2 happens to show only one RB
  // because somebody left a slot empty. Capacity is the max, not the latest.
  const cap = capacityFromStarters([
    { week: 1, espn_team_id: 1, lineup_slot_id: RB },
    { week: 1, espn_team_id: 1, lineup_slot_id: RB },
    { week: 1, espn_team_id: 1, lineup_slot_id: FLEX },
    { week: 2, espn_team_id: 1, lineup_slot_id: RB },
    { week: 2, espn_team_id: 2, lineup_slot_id: RB },
    { week: 2, espn_team_id: 2, lineup_slot_id: RB },
  ]);
  assert.equal(cap.get(RB), 2);
  assert.equal(cap.get(FLEX), 1);
  assert.equal(cap.get(QB), undefined, 'a slot nobody started is not invented');
});

test('a player with no eligible slots is dropped, not valued at zero', () => {
  // A player the lineup solver could never place must not appear in a trade.
  // Counting him at zero would make him look like a free giveaway.
  const rows: ScoringRow[] = [
    player(1, 'Placeable', RB, [RB, FLEX], 12),
    { ...player(2, 'Unplaceable', RB, [], 30), eligible_slots: [] },
    { ...player(3, 'Unknown slots', RB, [], 30), eligible_slots: null },
    { ...player(4, 'No position', 0, [RB], 30), default_position_id: null },
  ];
  const res = buildTradeReport(inputs({ scoring: rows }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.report.players, 1, 'only the placeable player counts');
});

test('a bench-only player cannot be traded into a starting lineup', () => {
  // Eligible for the bench and nothing else: real (an IR-stashed player looks
  // like this), and the solver must never find a lineup for him.
  const res = buildTradeReport(inputs({
    scoring: [player(9, 'Bench only', RB, [BENCH], 25)],
    latest: [{ espn_team_id: 1, espn_player_id: 9 }],
    fills: [{ lineup_slot_id: RB, default_position_id: RB, n: 10 }],
  }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.report.suggestions.length, 0);
});

test('the report carries the team names the page needs to render', () => {
  const res = buildTradeReport(inputs({
    scoring: [player(1, 'A', RB, [RB, FLEX], 10)],
    latest: [{ espn_team_id: 1, espn_player_id: 1 }],
  }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.report.teams.get(1), 'Alpha');
  assert.equal(res.report.season, 2026);
  assert.equal(res.report.throughWeek, 4);
});

test('filtering to one team narrows the board but not the model', () => {
  // Replacement levels are league-wide by definition, so a filter must apply
  // AFTER the search. The levels reported must not move when it is applied.
  const roster: TradeInputs['scoring'] = [
    player(1, 'A RB', RB, [RB, FLEX], 18), player(2, 'A WR', WR, [WR, FLEX], 4),
    player(3, 'B RB', RB, [RB, FLEX], 3), player(4, 'B WR', WR, [WR, FLEX], 17),
    player(5, 'C RB', RB, [RB, FLEX], 9), player(6, 'C WR', WR, [WR, FLEX], 9),
  ];
  const latest = [
    { espn_team_id: 1, espn_player_id: 1 }, { espn_team_id: 1, espn_player_id: 2 },
    { espn_team_id: 2, espn_player_id: 3 }, { espn_team_id: 2, espn_player_id: 4 },
    { espn_team_id: 3, espn_player_id: 5 }, { espn_team_id: 3, espn_player_id: 6 },
  ];
  const fills = [
    { lineup_slot_id: RB, default_position_id: RB, n: 20 },
    { lineup_slot_id: WR, default_position_id: WR, n: 20 },
    { lineup_slot_id: FLEX, default_position_id: RB, n: 5 },
    { lineup_slot_id: FLEX, default_position_id: WR, n: 5 },
  ];
  const base = {
    scoring: roster, latest, fills,
    capacity: new Map([[RB, 1], [WR, 1]]),
    teams: new Map([[1, 'Alpha'], [2, 'Beta'], [3, 'Gamma']]),
  };
  const all = buildTradeReport(inputs(base));
  const one = buildTradeReport(inputs({ ...base, teamId: 3 }));
  assert.equal(all.ok, true);
  assert.equal(one.ok, true);
  if (!all.ok || !one.ok) return;

  assert.deepEqual(one.report.levels, all.report.levels,
    'filtering must not change league-wide replacement levels');
  assert.ok(one.report.suggestions.length <= all.report.suggestions.length);
  for (const t of one.report.suggestions) {
    assert.ok(t.teamA === 3 || t.teamB === 3, 'every filtered trade must involve the team');
  }
});
