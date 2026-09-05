import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalEspnTeamId, canonicalEspnTeamIdSql } from './franchise-identity.ts';

test('the 2005 team 7 slot belongs to the durable CTE franchise', () => {
  assert.equal(canonicalEspnTeamId(2005, 7), 10);
});

test('the alias is deliberately limited to that one historical season', () => {
  assert.equal(canonicalEspnTeamId(2006, 7), 7);
  assert.equal(canonicalEspnTeamId(2005, 10), 10);
  assert.equal(canonicalEspnTeamId(2005, 1), 1);
  assert.equal(canonicalEspnTeamId(2017, 10), 10);
});

test('SQL rivalry queries use the same canonical rule', () => {
  assert.equal(
    canonicalEspnTeamIdSql('m.season', 'm.home_team_id'),
    '(case when m.season = 2005 and m.home_team_id = 7 then 10 else m.home_team_id end)'
  );
});
