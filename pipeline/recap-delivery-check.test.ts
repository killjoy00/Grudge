import assert from 'node:assert/strict';
import test from 'node:test';

import { assessRecapDelivery, type RecapDeliveryState } from './recap-delivery-check.ts';

const healthy: RecapDeliveryState = {
  season: 2026,
  week: 1,
  resultsComplete: true,
  teamCount: 10,
  resultTeams: 10,
  totalMatchups: 5,
  finalMatchups: 5,
  eligible: 11,
  sent: 11,
  failed: 0,
  sending: 0,
};

test('delivery watchdog reports a complete recap when every eligible member was sent', () => {
  const result = assessRecapDelivery(healthy);
  assert.equal(result.complete, true);
  assert.equal(result.missing, 0);
});

test('delivery watchdog identifies missing recipients for a safe idempotent retry', () => {
  const result = assessRecapDelivery({ ...healthy, sent: 9, failed: 1 });
  assert.equal(result.complete, false);
  assert.equal(result.missing, 2);
  assert.equal(result.failed, 1);
});

test('delivery watchdog refuses to send an older recap while the current week is unsettled', () => {
  assert.throws(
    () => assessRecapDelivery({ ...healthy, resultsComplete: false }),
    /not results_complete; refusing to send an older recap/
  );
});

test('delivery watchdog refuses partial team or matchup results', () => {
  assert.throws(
    () => assessRecapDelivery({ ...healthy, resultTeams: 9 }),
    /9\/10 team results/
  );
  assert.throws(
    () => assessRecapDelivery({ ...healthy, finalMatchups: 4 }),
    /4\/5 final matchups/
  );
});

test('delivery watchdog treats an empty eligible recipient set as an operational failure', () => {
  assert.throws(
    () => assessRecapDelivery({ ...healthy, eligible: 0, sent: 0 }),
    /No active league members are eligible/
  );
});
