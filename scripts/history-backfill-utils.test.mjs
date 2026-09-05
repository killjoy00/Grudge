import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeTransactions } from './history-backfill-utils.mjs';

test('mergeTransactions combines scoring-period payloads in stable order', () => {
  const merged = mergeTransactions([
    {
      transactions: [
        { id: 'w2-late', scoringPeriodId: 2, proposedDate: 300 },
        { id: 'w1', scoringPeriodId: 1, proposedDate: 200 },
      ],
    },
    {
      transactions: [
        { id: 'w2-early', scoringPeriodId: 2, proposedDate: 100 },
      ],
    },
  ]);

  assert.deepEqual(merged.map((row) => row.id), ['w1', 'w2-early', 'w2-late']);
});

test('mergeTransactions deduplicates transactions repeated by ESPN', () => {
  const merged = mergeTransactions([
    { transactions: [{ id: 'same', scoringPeriodId: 1, status: 'PENDING' }] },
    { transactions: [{ id: 'same', scoringPeriodId: 1, status: 'EXECUTED' }] },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'EXECUTED');
});

test('mergeTransactions ignores malformed rows without an id', () => {
  const merged = mergeTransactions([
    { transactions: [null, {}, { id: 'valid', scoringPeriodId: 1 }] },
    {},
  ]);

  assert.deepEqual(merged.map((row) => row.id), ['valid']);
});
