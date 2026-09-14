import assert from 'node:assert/strict';
import test from 'node:test';

import type { EspnLeague } from './espn.ts';
import {
  assertMeaningfulScoreSnapshot,
  assertSameSlate,
  scoreboardRefreshStatements,
  scoreboardRowsFromBoxscore,
} from './scoreboard-refresh-write.ts';
import type { MatchupRow } from './normalize.ts';

const matchup: MatchupRow = {
  season: 2026,
  week: 1,
  espn_matchup_id: 1,
  home_team_id: 4,
  away_team_id: 9,
  home_points: 118.4,
  away_points: 104.1,
  winner: 'HOME',
  playoff_tier: 'NONE',
  is_final: true,
};

const league: EspnLeague = {
  id: 114052,
  seasonId: 2026,
  scoringPeriodId: 1,
  settings: {
    name: 'Test league',
    size: 10,
    scheduleSettings: {
      matchupPeriodCount: 14,
      playoffTeamCount: 6,
      matchupPeriods: { '1': [1] },
    },
    rosterSettings: { lineupSlotCounts: { '0': 1, '2': 1, '20': 1 } },
    acquisitionSettings: {},
  },
};

const entry = (playerId: number, lineupSlotId: number, points: number) => ({
  playerId,
  lineupSlotId,
  playerPoolEntry: { appliedStatTotal: points },
});

const boxscore: EspnLeague = {
  id: 114052,
  seasonId: 2026,
  scoringPeriodId: 1,
  schedule: [{
    id: 1,
    matchupPeriodId: 1,
    winner: 'UNDECIDED',
    away: {
      teamId: 9,
      totalPoints: 0,
      rosterForCurrentScoringPeriod: {
        entries: [entry(1, 0, 10), entry(2, 2, 5.25), entry(3, 20, 99)],
      },
    },
    home: {
      teamId: 4,
      totalPoints: 0,
      rosterForCurrentScoringPeriod: {
        entries: [entry(4, 0, 7.1), entry(5, 2, 8.2), entry(6, 20, 88)],
      },
    },
  }],
};

test('Monday scoreboard refresh changes scores only', () => {
  const [write] = scoreboardRefreshStatements([matchup]);
  assert.ok(write);
  assert.match(write.text, /set home_points = \$1,\s+away_points = \$2/);
  assert.doesNotMatch(write.text, /winner\s*=/);
  assert.doesNotMatch(write.text, /is_final\s*=/);
  assert.doesNotMatch(write.text, /results_complete/);
  assert.deepEqual(write.params.slice(0, 2), [118.4, 104.1]);
});

test('Monday scoreboard refresh requires the exact stored slate', () => {
  assert.doesNotThrow(() => assertSameSlate(
    [{ espn_matchup_id: 1, home_team_id: 4, away_team_id: 9 }],
    [matchup],
  ));

  assert.throws(() => assertSameSlate(
    [{ espn_matchup_id: 1, home_team_id: 4, away_team_id: 9 }],
    [{ ...matchup, away_team_id: 8 }],
  ), /does not match/);
});

test('live boxscore starter totals replace stale zero matchup totals', () => {
  const rows = scoreboardRowsFromBoxscore(league, boxscore, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.away_points, 15.25);
  assert.equal(rows[0]?.home_points, 15.3);
  assert.doesNotThrow(() => assertMeaningfulScoreSnapshot(rows));
});

test('non-zero provider total wins over starter sum for score adjustments', () => {
  const adjusted = structuredClone(boxscore);
  adjusted.schedule![0]!.home!.totalPoints = 16.3;
  const [row] = scoreboardRowsFromBoxscore(league, adjusted, 1);
  assert.equal(row?.home_points, 16.3);
});

test('all-zero snapshot fails instead of reporting a successful refresh', () => {
  assert.throws(
    () => assertMeaningfulScoreSnapshot([{ ...matchup, home_points: 0, away_points: 0 }]),
    /all-zero/,
  );
});
