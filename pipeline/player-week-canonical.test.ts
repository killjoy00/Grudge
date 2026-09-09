import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalPlayerKey } from './player-week.ts';

test('ESPN defense ids use canonical D/ST player keys', () => {
  assert.equal(canonicalPlayerKey(-16001), 'dst:1');
  assert.equal(canonicalPlayerKey(-16002), 'dst:2');
  assert.equal(canonicalPlayerKey(-16034), 'dst:34');
});

test('unknown non-defense ESPN ids remain explicit provider placeholders', () => {
  assert.equal(canonicalPlayerKey(-42), 'espn:-42');
});
