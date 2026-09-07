import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DRAFT_VALUE_METHOD, GRADED_DRAFT_CTE, draftValueDelta } from './draft-ranking.ts';

test('draft value compares position-adjusted production with overall draft capital', () => {
  assert.equal(draftValueDelta(100, 10), 90);
  assert.equal(draftValueDelta(20, 90), -70);
  assert.equal(draftValueDelta(64.126, 50.124), 14);
  assert.match(DRAFT_VALUE_METHOD, /production percentile.*overall-pick capital percentile/);
});

test('the database grade uses bounded percentiles and actual overall pick', () => {
  assert.match(GRADED_DRAFT_CTE, /partition by season, default_position_id\s+order by fantasy_points/);
  assert.match(GRADED_DRAFT_CTE, /partition by season\s+order by overall_pick/);
  assert.match(GRADED_DRAFT_CTE, /production_score - draft_capital_score/);
  assert.match(GRADED_DRAFT_CTE, /count\(\*\) filter \(where points <> 0\).*active_weeks/);
  assert.doesNotMatch(GRADED_DRAFT_CTE, /draft_pos_rank - production_pos_rank/);
});
