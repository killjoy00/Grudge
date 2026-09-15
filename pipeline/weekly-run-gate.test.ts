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

test('explicit retry push and manual triggers always run', () => {
  assert.equal(assessWeeklyRunGate('push', state({ resultsComplete: true, sent: 11 })).shouldRun, true);
  assert.equal(
    assessWeeklyRunGate('workflow_dispatch', state({ resultsComplete: true, sent: 11 })).shouldRun,
    true
  );
});

test('scheduled run proceeds while latest week is unsettled', () => {
  assert.equal(assessWeeklyRunGate('schedule', state()).shouldRun, true);
});

test('independent morning trigger proceeds while latest week is unsettled', () => {
  assert.equal(assessWeeklyRunGate('morning', state()).shouldRun, true);
});

test('scheduled or morning trigger proceeds if recap acceptance is incomplete', () => {
  const incomplete = state({ resultsComplete: true, sent: 10 });
  assert.equal(assessWeeklyRunGate('schedule', incomplete).shouldRun, true);
  assert.equal(assessWeeklyRunGate('morning', incomplete).shouldRun, true);
});

test('scheduled and morning backstops skip once week and recap acceptance are complete', () => {
  const complete = state({ resultsComplete: true, sent: 11 });
  for (const trigger of ['schedule', 'morning']) {
    const decision = assessWeeklyRunGate(trigger, complete);
    assert.equal(decision.shouldRun, false);
    assert.match(decision.reason, /11\/11/);
  }
});

test('preseason backstop behavior remains enabled', () => {
  const preseason = state({ week: null, resultsComplete: false });
  assert.equal(assessWeeklyRunGate('schedule', preseason).shouldRun, true);
  assert.equal(assessWeeklyRunGate('morning', preseason).shouldRun, true);
});
