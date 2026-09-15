import assert from 'node:assert/strict';
import test from 'node:test';

import { assessWeeklyRunGate, type WeeklyGateState } from './weekly-run-gate.ts';

function state(overrides: Partial<WeeklyGateState> = {}): WeeklyGateState {
  return {
    season: 2026,
    week: 1,
    resultsComplete: false,
    eligible: 11,
    sent: 0,
    ...overrides,
  };
}

test('explicit push and manual triggers always run', () => {
  assert.equal(assessWeeklyRunGate('push', state({ resultsComplete: true, sent: 11 })).shouldRun, true);
  assert.equal(
    assessWeeklyRunGate('workflow_dispatch', state({ resultsComplete: true, sent: 11 })).shouldRun,
    true
  );
});

test('scheduled run proceeds while latest week is unsettled', () => {
  assert.equal(assessWeeklyRunGate('schedule', state()).shouldRun, true);
});

test('scheduled run proceeds if recap acceptance is incomplete', () => {
  assert.equal(
    assessWeeklyRunGate('schedule', state({ resultsComplete: true, sent: 10 })).shouldRun,
    true
  );
});

test('scheduled backstop skips once week and recap acceptance are complete', () => {
  const decision = assessWeeklyRunGate('schedule', state({ resultsComplete: true, sent: 11 }));
  assert.equal(decision.shouldRun, false);
  assert.match(decision.reason, /11\/11/);
});

test('preseason scheduled behavior remains enabled', () => {
  assert.equal(
    assessWeeklyRunGate('schedule', state({ week: null, resultsComplete: false })).shouldRun,
    true
  );
});
