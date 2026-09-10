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

test('historical provider-ID collisions resolve by season before the global crosswalk', () => {
  assert.equal(canonicalPlayerKey(13103), 'gsis:00-0026857');
  assert.equal(canonicalPlayerKey(13103, 2005), 'gsis:00-0020514');
});
