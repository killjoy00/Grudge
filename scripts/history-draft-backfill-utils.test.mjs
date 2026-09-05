import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeDraftDetail, mergeDraftManifest } from './history-draft-backfill-utils.mjs';

test('draft repair replaces only draftDetail and preserves archived evidence', () => {
  const original = {
    seasonId: 2024,
    teams: [{ id: 1 }],
    schedule: [{ id: 99, winner: 'HOME' }],
    transactions: [{ id: 'tx-1' }],
    draftDetail: { picks: [] },
  };
  const draftDetail = { picks: [{ id: 1, teamId: 3, playerId: 123 }] };
  const merged = mergeDraftDetail(original, draftDetail, 2024);

  assert.deepEqual(merged.teams, original.teams);
  assert.deepEqual(merged.schedule, original.schedule);
  assert.deepEqual(merged.transactions, original.transactions);
  assert.deepEqual(merged.draftDetail, draftDetail);
  assert.notEqual(merged, original);
});

test('draft repair rejects an empty board', () => {
  assert.throws(() => mergeDraftDetail({ seasonId: 2024 }, { picks: [] }, 2024), /no picks/);
});

test('manifest merge preserves existing availability facts', () => {
  const merged = mergeDraftManifest(
    { availability: { weeklyMatchupScores: true, totalUniqueTransactions: 832 }, source: 'existing archive' },
    160,
    '2026-09-05T00:00:00.000Z'
  );
  assert.deepEqual(merged.availability, {
    weeklyMatchupScores: true,
    totalUniqueTransactions: 832,
    draftBoard: true,
    draftPicks: 160,
  });
  assert.equal(merged.source, 'existing archive');
  assert.equal(merged.draftBackfilledAt, '2026-09-05T00:00:00.000Z');
});
