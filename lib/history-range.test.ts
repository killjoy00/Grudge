import { test } from 'node:test';
import assert from 'node:assert/strict';

import { historyRange } from './history-range.ts';

test('history range defaults to full history until a bound is supplied', () => {
  assert.equal(historyRange(undefined, undefined, 2005, 2025), null);
  assert.deepEqual(historyRange('2015', undefined, 2005, 2025), { from: 2015, to: 2025 });
  assert.deepEqual(historyRange('2015', '', 2005, 2025), { from: 2015, to: 2025 });
  assert.deepEqual(historyRange(undefined, '2018', 2005, 2025), { from: 2005, to: 2018 });
});

test('history range clamps and orders URL input', () => {
  assert.deepEqual(historyRange('2030', '2000', 2005, 2025), { from: 2005, to: 2025 });
  assert.deepEqual(historyRange('2018', '2010', 2005, 2025), { from: 2010, to: 2018 });
  assert.deepEqual(historyRange('nope', '2012', 2005, 2025), { from: 2005, to: 2012 });
});
