/**
 * Trade reconstruction tests.
 *
 * The thing worth protecting here is not that a trade is found -- it is that a
 * waiver claim is NOT found as one. Every manager in this league drops and
 * adds players weekly, and a detector that reports those as trades would put
 * fiction on a public page and grade managers on it.
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

test('a swap between two teams across a week boundary is a trade', () => {
  const entries = [
    ...own(1, 3, 100, 101), ...own(1, 5, 200, 201),
    ...own(2, 3, 200, 101), ...own(2, 5, 100, 201),
  ];
  const trades = detectTrades(2026, entries, []);
  assert.equal(trades.length, 1);
  const t = trades[0]!;
  assert.equal(t.trade_id, '2026-w2-3v5');
  assert.equal(t.effective_week, 2);
  assert.equal(t.team_a, 3);
  assert.equal(t.team_b, 5);
  assert.deepEqual(
    t.players.map((p) => [p.espn_player_id, p.from_team_id, p.to_team_id]),
    [[100, 3, 5], [200, 5, 3]]
  );
});

test('a waiver drop and claim is not a trade', () => {
  // Team 3 drops 100 in period 2, team 5 claims him. Ownership moves 3 -> 5
  // exactly as a trade would; only the transactions distinguish them.
  const entries = [...own(1, 3, 100), ...own(2, 5, 100)];
  const tx: LedgerTransaction[] = [{
    id: 'w1', type: 'WAIVER', status: 'EXECUTED', scoringPeriodId: 2, teamId: 5, proposedDate: 10,
    items: [{ type: 'ADD', playerId: 100 }],
  }];
  assert.deepEqual(detectTrades(2026, entries, tx), []);
});

test('a claim stamped in the previous scoring period still suppresses the move', () => {
  // ESPN stamps the claim period 1 but processes it after the week 1 snapshot,
  // so the player moves between snapshot 1 and 2. Narrowing the window to
  // period 2 alone would report this as a trade.
  const entries = [...own(1, 3, 100), ...own(2, 5, 100)];
  const tx: LedgerTransaction[] = [{
    id: 'w1', type: 'WAIVER', status: 'EXECUTED', scoringPeriodId: 1, teamId: 5, proposedDate: 10,
    items: [{ type: 'ADD', playerId: 100 }],
  }];
  assert.deepEqual(detectTrades(2026, entries, tx), []);
});

test('a failed waiver does not suppress a real trade', () => {
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
  assert.deepEqual(
    trades[0]!.players.map((p) => p.espn_player_id).sort((a, b) => a - b),
    [100, 200]
  );
});

test('a player added from free agency has no prior owner and is ignored', () => {
  const entries = [...own(1, 3, 100), ...own(2, 3, 100), ...own(2, 5, 999)];
  assert.deepEqual(detectTrades(2026, entries, [draft([[100, 3]])]), []);
});

test('an uneven trade is one trade, not two', () => {
  const entries = [
    ...own(1, 3, 100, 101, 102), ...own(1, 5, 200),
    ...own(2, 3, 200, 102), ...own(2, 5, 100, 101),
  ];
  const trades = detectTrades(2026, entries, []);
  assert.equal(trades.length, 1);
  assert.equal(trades[0]!.players.length, 3);
});

test('two separate pairs trading in the same week are two trades', () => {
  const entries = [
    ...own(1, 1, 10), ...own(1, 2, 20), ...own(1, 3, 30), ...own(1, 4, 40),
    ...own(2, 1, 20), ...own(2, 2, 10), ...own(2, 3, 40), ...own(2, 4, 30),
  ];
  const trades = detectTrades(2026, entries, []);
  assert.deepEqual(trades.map((t) => t.trade_id), ['2026-w2-1v2', '2026-w2-3v4']);
});

test('a TRADE_ACCEPT in the window is attached to the trade', () => {
  const entries = [...own(1, 3, 100), ...own(1, 5, 200), ...own(2, 3, 200), ...own(2, 5, 100)];
  const tx: LedgerTransaction[] = [{
    id: 'accept-1', type: 'TRADE_ACCEPT', scoringPeriodId: 2, teamId: 5,
    proposedDate: Date.UTC(2026, 8, 1), items: [],
  }];
  const t = detectTrades(2026, entries, tx)[0]!;
  assert.equal(t.espn_transaction_id, 'accept-1');
  assert.equal(t.accepted_at, new Date(Date.UTC(2026, 8, 1)).toISOString());
});

test('two accepts in one window are attached to neither trade', () => {
  // Corroboration must be unambiguous. Guessing which envelope belongs to
  // which pair would print a wrong date next to a real trade.
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

test('no roster snapshots means no trades rather than a crash', () => {
  assert.deepEqual(detectTrades(2026, [], [draft([[100, 3]])]), []);
});

/* ------------------------------- seasons with no ledger (2018-2025 archive) */

test('with no transactions at all, a one-way move is left alone', () => {
  // This is the whole safeguard for the historical archive. Those seasons have
  // full weekly rosters and NO transactions, so every waiver claim looks
  // exactly like a one-sided trade. Roughly 20 of these happen per season.
  const entries = [...own(1, 3, 100), ...own(2, 5, 100)];
  assert.deepEqual(detectTrades(2021, entries, []), []);
});

test('with no transactions, a two-way swap is still a trade', () => {
  const entries = [...own(1, 3, 100), ...own(1, 5, 200), ...own(2, 3, 200), ...own(2, 5, 100)];
  const trades = detectTrades(2021, entries, []);
  assert.equal(trades.length, 1);
  assert.equal(trades[0]!.confidence, 'reciprocal');
});

test('with a ledger, a one-way move IS a trade', () => {
  // A player for nothing, or for FAAB. Only findable where the transactions
  // rule out a waiver claim, which is why the two rules are not the same rule.
  const entries = [...own(1, 3, 100), ...own(2, 5, 100)];
  const tx: LedgerTransaction[] = [{
    id: 'unrelated', type: 'WAIVER', status: 'EXECUTED', scoringPeriodId: 2, teamId: 1,
    proposedDate: 5, items: [{ type: 'ADD', playerId: 777 }],
  }];
  const trades = detectTrades(2026, entries, tx);
  assert.equal(trades.length, 1);
  assert.equal(trades[0]!.confidence, 'ledger');
});

test('trade ids are stable across reruns', () => {
  const entries = [...own(1, 3, 100), ...own(1, 5, 200), ...own(2, 3, 200), ...own(2, 5, 100)];
  const a = detectTrades(2026, entries, []);
  const b = detectTrades(2026, [...entries].reverse(), []);
  assert.deepEqual(a.map((t) => t.trade_id), b.map((t) => t.trade_id));
});
