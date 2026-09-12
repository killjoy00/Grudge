import assert from 'node:assert/strict';
import test from 'node:test';

import { previewStatements } from './preview-write.ts';
import type { DraftPickRow, MatchupProjectionRow } from './normalize.ts';

const projection: MatchupProjectionRow = {
  season: 2026,
  week: 1,
  espn_matchup_id: 7,
  espn_team_id: 4,
  projected_points: 112.6,
  starters: 10,
};

const pick: DraftPickRow = {
  season: 2026,
  overall_pick: 26,
  round: 3,
  round_pick: 6,
  espn_team_id: 4,
  espn_player_id: 4870808,
  is_keeper: false,
};

const capturedAt = '2026-09-09T23:53:09.929Z';

test('routine preview reruns preserve the first weekly projection snapshot', () => {
  const statements = previewStatements([projection], [pick], 2026, capturedAt);
  const projectionWrite = statements[0];
  assert.ok(projectionWrite);
  assert.match(
    projectionWrite.text,
    /on conflict \(season, week, espn_team_id\) do nothing/,
  );
  assert.equal(projectionWrite.params.at(-1), capturedAt);
});

test('an explicit recapture moves values and captured_at together', () => {
  const statements = previewStatements([projection], [], 2026, capturedAt, true);
  const projectionWrite = statements[0];
  assert.ok(projectionWrite);
  assert.match(projectionWrite.text, /projected_points = excluded\.projected_points/);
  assert.match(projectionWrite.text, /starters = excluded\.starters/);
  assert.match(projectionWrite.text, /captured_at = excluded\.captured_at/);
  assert.equal(projectionWrite.params.at(-1), capturedAt);
});

test('week-ahead writes repair legacy player placeholders from canonical identity', () => {
  const statements = previewStatements([], [], 2026, capturedAt);
  const identityRepair = statements.at(-1);
  assert.ok(identityRepair);
  assert.match(identityRepair.text, /from public\.player_identity pi/);
  assert.match(identityRepair.text, /p\.full_name = 'ESPN player #' \|\| p\.espn_player_id::text/);
  assert.deepEqual(identityRepair.params, [2026]);
});
