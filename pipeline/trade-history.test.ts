/**
 * Trade reconstruction tests.
 *
 * The most important invariant is negative: never publish a trade that did not
 * happen. ESPN's itemized completed transaction is authoritative when present;
 * weekly roster movement is only a reciprocal fallback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectTrades, type LedgerTransaction, type OwnershipRow } from './trade-history.ts';

const own = (week: number, teamId: number, ...players: number[]): OwnershipRow[] =>
  players.map((espn_player_id) => ({ week, espn_team_id: teamId, espn_player_id }));

const draft = (assignments: [number, number][]): LedgerTransaction => ({
  id: 'draft', type: 'DRAFT', status: 'EXECUTED', scoringPeriodId: 0, proposedDate: 1,
  items: assignments.map(([playerId, toTeamId]) => ({ type: 'DRAFT', playerId, toTeamId })),
});

const completedTrade = (
  id: string,
  week: number,
  moves: Array<[number, number, number]>,
  type: 'TRADE_ACCEPT' | 'TRADE_UPHOLD' = 'TRADE_ACCEPT'
): LedgerTransaction => ({
  id, type, status: 'EXECUTED', scoringPeriodId: week, proposedDate: week * 1000,
  relatedTransactionId: `proposal-${id}`,
  items: moves.map(([playerId, fromTeamId, toTeamId]) => ({
    type: 'TRADE', playerId, fromTeamId, toTeamId,
  })),
});

test('a swap between two teams across a week boundary is reconstructed', () => {
  const entries = [
    ...own(1, 3, 100, 101), ...own(1, 5, 200, 201),
    ...own(2, 3, 200, 101), ...own(2, 5, 100, 201),
  ];
  const trades = detectTrades(2026, entries, []);
  assert.equal(trades.length, 1);
  const t = trades[0]!;
  assert.equal(t.trade_id, '2026-w2-3v5');
  assert.equal(t.confidence, 'reciprocal');
  assert.deepEqual(
    t.players.map((p) => [p.espn_player_id, p.from_team_id, p.to_team_id]),
    [[100, 3, 5], [200, 5, 3]]
  );
});

test('an itemized completed trade is authoritative even without roster snapshots', () => {
  const tx = [completedTrade('trade-1', 7, [[100, 1, 9], [200, 9, 1]])];
  const trades = detectTrades(2022, [], tx);
  assert.equal(trades.length, 1);
  assert.equal(trades[0]!.confidence, 'ledger');
  assert.equal(trades[0]!.espn_transaction_id, 'trade-1');
  assert.equal(trades[0]!.effective_week, 7);
  assert.deepEqual(trades[0]!.players.map((p) => p.espn_player_id), [100, 200]);
});

test('an itemized TRADE_UPHOLD completion is authoritative', () => {
  const tx = [completedTrade('uphold-1', 2, [[100, 1, 4], [200, 4, 1]], 'TRADE_UPHOLD')];
  const trades = detectTrades(2018, [], tx);
  assert.equal(trades.length, 1);
  assert.equal(trades[0]!.confidence, 'ledger');
  assert.equal(trades[0]!.espn_transaction_id, 'uphold-1');
});

test('a pending itemized proposal is not treated as a completed trade', () => {
  const tx: LedgerTransaction[] = [{
    ...completedTrade('proposal', 2, [[100, 1, 4], [200, 4, 1]]),
    type: 'TRADE_PROPOSAL', status: 'PENDING',
  }];
  assert.deepEqual(detectTrades(2018, [], tx), []);
});

test('a malformed one-direction itemized completion is not published', () => {
  const tx = [completedTrade('bad', 2, [[100, 1, 4], [101, 1, 4]])];
  assert.deepEqual(detectTrades(2022, [], tx), []);
});

test('same-window double movement uses real trades instead of a fictional net trade', () => {
  // Mirrors 2022: Patterson went 9 -> 1 and then 1 -> 3 before the next weekly
  // snapshot. Endpoint inference alone sees 9 -> 3 and invents a 3/9 trade.
  const entries = [
    ...own(6, 9, 100), ...own(6, 1, 200), ...own(6, 3, 300),
    ...own(7, 3, 100), ...own(7, 9, 200), ...own(7, 1, 300),
  ];
  const tx = [
    completedTrade('first', 7, [[100, 9, 1], [200, 1, 9]]),
    completedTrade('second', 7, [[100, 1, 3], [300, 3, 1]]),
  ];
  const trades = detectTrades(2022, entries, tx);
  assert.deepEqual(trades.map((t) => [t.team_a, t.team_b, t.confidence]), [
    [1, 3, 'ledger'],
    [1, 9, 'ledger'],
  ]);
  assert.equal(trades.some((t) => t.team_a === 3 && t.team_b === 9), false);
});

test('a waiver drop and claim is not a trade', () => {
  const entries = [...own(1, 3, 100), ...own(2, 5, 100)];
  const tx: LedgerTransaction[] = [{
    id: 'w1', type: 'WAIVER', status: 'EXECUTED', scoringPeriodId: 2, teamId: 5, proposedDate: 10,
    items: [{ type: 'ADD', playerId: 100 }],
  }];
  assert.deepEqual(detectTrades(2026, entries, tx), []);
});

test('a claim stamped in the previous scoring period still suppresses the move', () => {
  const entries = [...own(1, 3, 100), ...own(2, 5, 100)];
  const tx: LedgerTransaction[] = [{
    id: 'w1', type: 'WAIVER', status: 'EXECUTED', scoringPeriodId: 1, teamId: 5, proposedDate: 10,
    items: [{ type: 'ADD', playerId: 100 }],
  }];
  assert.deepEqual(detectTrades(2026, entries, tx), []);
});

test('a failed waiver does not suppress a real reciprocal trade', () => {
  const entries = [...own(1, 3, 100), ...own(1, 5, 200), ...own(2, 3, 200), ...own(2, 5, 100)];
  const tx: LedgerTransaction[] = [{
    id: 'w1', type: 'WAIVER', status: 'FAILED_ROSTERLIMIT', scoringPeriodId: 2, teamId: 5,
    proposedDate: 10, items: [{ type: 'ADD', playerId: 100 }],
  }];
  assert.equal(detectTrades(2026, entries, tx).length, 1);
});

test('a preseason trade is found by diffing week 1 against the draft', () => {
  const entries = [...own(1, 3, 200), ...own(1, 5, 100)];
  const trades = detectTrades(2026, entries, [draft([[100, 3], [200, 5]])]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0]!.effective_week, 1);
  assert.equal(trades[0]!.confidence, 'reciprocal');
});

test('a player added from free agency has no prior owner and is ignored', () => {
  const entries = [...own(1, 3, 100), ...own(2, 3, 100), ...own(2, 5, 999)];
  assert.deepEqual(detectTrades(2026, entries, [draft([[100, 3]])]), []);
});

test('an uneven reciprocal trade is one trade, not two', () => {
  const entries = [
    ...own(1, 3, 100, 101, 102), ...own(1, 5, 200),
    ...own(2, 3, 200, 102), ...own(2, 5, 100, 101),
  ];
  const trades = detectTrades(2026, entries, []);
  assert.equal(trades.length, 1);
  assert.equal(trades[0]!.players.length, 3);
});

test('two separate pairs trading in the same week are two reconstructed trades', () => {
  const entries = [
    ...own(1, 1, 10), ...own(1, 2, 20), ...own(1, 3, 30), ...own(1, 4, 40),
    ...own(2, 1, 20), ...own(2, 2, 10), ...own(2, 3, 40), ...own(2, 4, 30),
  ];
  const trades = detectTrades(2026, entries, []);
  assert.deepEqual(trades.map((t) => t.trade_id), ['2026-w2-1v2', '2026-w2-3v4']);
});

test('an empty TRADE_ACCEPT can corroborate a reciprocal reconstruction but not license it', () => {
  const entries = [...own(1, 3, 100), ...own(1, 5, 200), ...own(2, 3, 200), ...own(2, 5, 100)];
  const tx: LedgerTransaction[] = [{
    id: 'accept-1', type: 'TRADE_ACCEPT', scoringPeriodId: 2, teamId: 5,
    proposedDate: Date.UTC(2026, 8, 1), items: [],
  }];
  const t = detectTrades(2026, entries, tx)[0]!;
  assert.equal(t.confidence, 'reciprocal');
  assert.equal(t.espn_transaction_id, 'accept-1');
  assert.equal(t.accepted_at, new Date(Date.UTC(2026, 8, 1)).toISOString());
});

test('an unrelated ledger never turns a one-way ownership change into a trade', () => {
  const entries = [...own(1, 3, 100), ...own(2, 5, 100)];
  const tx: LedgerTransaction[] = [{
    id: 'unrelated', type: 'WAIVER', status: 'EXECUTED', scoringPeriodId: 2, teamId: 1,
    proposedDate: 5, items: [{ type: 'ADD', playerId: 777 }],
  }];
  assert.deepEqual(detectTrades(2026, entries, tx), []);
});

test('two empty accepts in one window are attached to neither reconstruction', () => {
  const entries = [
    ...own(1, 1, 10), ...own(1, 2, 20), ...own(1, 3, 30), ...own(1, 4, 40),
    ...own(2, 1, 20), ...own(2, 2, 10), ...own(2, 3, 40), ...own(2, 4, 30),
  ];
  const tx: LedgerTransaction[] = [
    { id: 'a1', type: 'TRADE_ACCEPT', scoringPeriodId: 2, teamId: 1, proposedDate: 1, items: [] },
    { id: 'a2', type: 'TRADE_ACCEPT', scoringPeriodId: 2, teamId: 2, proposedDate: 2, items: [] },
  ];
  const trades = detectTrades(2026, entries, tx);
  assert.deepEqual(trades.map((t) => t.espn_transaction_id), [null, null]);
});

test('no roster snapshots and no completed itemized trades means no trades', () => {
  assert.deepEqual(detectTrades(2026, [], [draft([[100, 3]])]), []);
});

test('trade ids are stable across roster input order', () => {
  const entries = [...own(1, 3, 100), ...own(1, 5, 200), ...own(2, 3, 200), ...own(2, 5, 100)];
  const a = detectTrades(2026, entries, []);
  const b = detectTrades(2026, [...entries].reverse(), []);
  assert.deepEqual(a.map((t) => t.trade_id), b.map((t) => t.trade_id));
});
