import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftInputsFromScores } from './model-publish.ts';
import type { DraftPerformanceSeason } from './draft-model.ts';

const base = {
  season: 2005,
  regular_weeks: 1,
  team_count: 2,
  total_picks: 4,
  board: [[1, 1, 101], [3, 2, 103]],
  excluded_board: [
    { overall_pick: 2, espn_team_id: 2, position: 'DST', evidence: 'espn_lineup_slot_16' },
    { overall_pick: 4, espn_team_id: 1, position: 'DST', evidence: 'manual_review_second_defense' },
  ],
  slot_counts: {},
  pool: [],
  picks: [],
} as DraftPerformanceSeason & {
  excluded_board: { overall_pick: number; espn_team_id: number; position: 'DST'; evidence: string }[];
};

const knownBoard = [
  { season: 2005, overall_pick: 1, espn_team_id: 1, espn_player_id: 101 },
  { season: 2005, overall_pick: 3, espn_team_id: 2, espn_player_id: 103 },
];

test('explicitly evidenced excluded slots can complete a historical draft board', () => {
  const result = draftInputsFromScores([base], [], knownBoard);
  assert.equal(result.coverage['2005']?.ready, true);
  assert.deepEqual(result.coverage['2005']?.reasons, []);
});

test('an unexplained missing coordinate still blocks the draft board', () => {
  const broken = { ...base, excluded_board: base.excluded_board.slice(0, 1) };
  const result = draftInputsFromScores([broken], [], knownBoard);
  assert.equal(result.coverage['2005']?.ready, false);
  assert.ok(result.coverage['2005']?.reasons.includes('draft_board_mismatch'));
});
