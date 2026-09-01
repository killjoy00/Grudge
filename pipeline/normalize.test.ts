/**
 * Normalizer tests, run against the ARCHIVED REAL PAYLOADS in data/history/
 * and exploration/raw/ -- seven fully-played seasons plus the live 2026 one.
 * Fixtures invented by hand would only prove the code matches my assumptions;
 * these prove it matches ESPN.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EspnLeague } from './espn.ts';
import {
  starterSlots, starterCount, starterSlotCounts, seasonRow, teamRows, matchupRows,
  rosterEntryRows, playerRows, weekRows, weekCompleteness, completedWeeks,
  finalScoringPeriod, BENCH_SLOT, IR_SLOT,
} from './normalize.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString()) as EspnLeague;
const history = (season: number) => readGz(join(ROOT, 'data/history', String(season), 'league.json.gz'));
const boxscore = (season: number, wk: number) =>
  readGz(join(ROOT, 'data/history', String(season), 'boxscores', `sp${String(wk).padStart(2, '0')}.json.gz`));

// 2020 is deliberately excluded everywhere: the league did not play that year.
const PLAYED = [2018, 2019, 2021, 2022, 2023, 2024, 2025].filter((y) =>
  existsSync(join(ROOT, 'data/history', String(y), 'league.json.gz'))
);

test('history fixtures are present', () => {
  assert.ok(PLAYED.length >= 5, `expected several played seasons, found ${PLAYED.length}`);
});

test('starter slots derive from settings, and exclude bench + IR', () => {
  for (const season of PLAYED) {
    const slots = starterSlots(history(season));
    assert.ok(slots.size > 0, `${season}: no starter slots derived`);
    assert.ok(!slots.has(BENCH_SLOT), `${season}: bench counted as starter`);
    assert.ok(!slots.has(IR_SLOT), `${season}: IR counted as starter`);
  }
});

test('season row reads real settings', () => {
  for (const season of PLAYED) {
    const r = seasonRow(history(season));
    assert.equal(r.season, season);
    assert.ok(r.league_name.length > 0);
    assert.ok(r.team_count > 0);
    assert.ok(r.regular_season_weeks > 0);
    assert.ok(r.final_scoring_period >= r.regular_season_weeks);
  }
});

test('team ids are non-contiguous and that is fine', () => {
  const teams = teamRows(history(2025));
  const ids = teams.map((t) => t.espn_team_id).sort((a, b) => a - b);
  assert.equal(teams.length, 10);
  // The specific gap this league has -- proves nothing assumes 1..n.
  assert.ok(!ids.includes(7), 'expected no team 7 in this league');
  assert.ok(ids.includes(11), 'expected a team 11');
});

test('matchups: decided games have scores and a real winner', () => {
  for (const season of PLAYED) {
    const rows = matchupRows(history(season));
    assert.ok(rows.length > 0, `${season}: no matchups`);
    const finals = rows.filter((m) => m.is_final);
    assert.ok(finals.length > 0, `${season}: no completed matchups`);
    for (const m of finals) {
      assert.notEqual(m.winner, 'UNDECIDED');
      assert.ok(m.home_points !== null && m.away_points !== null, `${season} m${m.espn_matchup_id}: final but no score`);
      assert.notEqual(m.home_team_id, m.away_team_id);
    }
  }
});

test("ESPN's winner agrees with the scores it reports", () => {
  // If these ever disagree, one of the two is not what we think it is.
  let checked = 0;
  for (const season of PLAYED) {
    for (const m of matchupRows(history(season))) {
      if (!m.is_final || m.home_points === null || m.away_points === null) continue;
      if (Math.abs(m.home_points - m.away_points) < 0.005) continue; // ties: rule is separate
      const expected = m.home_points > m.away_points ? 'HOME' : 'AWAY';
      assert.equal(m.winner, expected,
        `${season} matchup ${m.espn_matchup_id}: winner=${m.winner} but ${m.home_points}-${m.away_points}`);
      checked++;
    }
  }
  assert.ok(checked > 300, `expected to check many real games, only checked ${checked}`);
});

test('roster entries: starters vs bench split matches league settings', () => {
  const season = 2025;
  const league = history(season);
  const starters = starterSlots(league);
  // Slot COUNT, not slot-id count: RB x2 and WR x2 mean 8 slot ids -> 10 starters.
  const expectedStarters = starterCount(league);
  const bx = boxscore(season, 1);
  const rows = rosterEntryRows(bx, 1, starters);
  assert.ok(rows.length > 0, 'no roster entries parsed');

  const byTeam = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = byTeam.get(r.espn_team_id) ?? [];
    list.push(r);
    byTeam.set(r.espn_team_id, list);
  }
  for (const [teamId, entries] of byTeam) {
    const n = entries.filter((e) => e.is_starter).length;
    assert.equal(n, expectedStarters, `team ${teamId} started ${n}, settings say ${expectedStarters}`);
  }
});

test('roster entries carry the points optimal-lineup needs', () => {
  const league = history(2025);
  const rows = rosterEntryRows(boxscore(2025, 1), 1, starterSlots(league));
  const scored = rows.filter((r) => r.applied_points !== null && r.applied_points > 0);
  assert.ok(scored.length > 20, `expected many scoring players in a played week, got ${scored.length}`);
});

test('roster entries carry the projection a surprise is measured against', () => {
  // The recap calls a week a surprise by comparing actual to projected, so the
  // projection has to be a genuinely different number -- reading statSourceId 0
  // twice would look fine here and make every player exactly as expected.
  for (const season of PLAYED) {
    const week = 1;
    const rows = rosterEntryRows(boxscore(season, week), week, starterSlots(history(season)));
    const projected = rows.filter((r) => r.projected_points !== null && r.projected_points > 0);
    assert.ok(projected.length > 20,
      `${season}: expected many projected players, got ${projected.length}`);

    const differ = projected.filter(
      (r) => r.applied_points !== null && Math.abs(r.applied_points - r.projected_points!) > 0.01
    );
    assert.ok(differ.length > projected.length / 2,
      `${season}: only ${differ.length}/${projected.length} players differed from their projection` +
      ' -- that reads like the actual score, not the projection');
  }
});

test('a team starting-lineup total reconciles with its matchup score', () => {
  // The strongest available check that slot semantics are right: summing the
  // players we call starters must reproduce ESPN's own team total.
  const season = 2025;
  const league = history(season);
  const starters = starterSlots(league);
  const week = 1;
  const rows = rosterEntryRows(boxscore(season, week), week, starters);
  const matchups = matchupRows(league).filter((m) => m.week === week && m.is_final);
  assert.ok(matchups.length > 0, 'no final matchups in week 1');

  let compared = 0;
  for (const m of matchups) {
    for (const [teamId, reported] of [
      [m.home_team_id, m.home_points] as const,
      [m.away_team_id, m.away_points] as const,
    ]) {
      if (reported === null) continue;
      const sum = rows
        .filter((r) => r.espn_team_id === teamId && r.is_starter)
        .reduce((acc, r) => acc + (r.applied_points ?? 0), 0);
      assert.ok(Math.abs(sum - reported) < 0.2,
        `${season} wk${week} team ${teamId}: starters sum ${sum.toFixed(2)} vs reported ${reported}`);
      compared++;
    }
  }
  assert.ok(compared >= 8, `expected to reconcile most teams, did ${compared}`);
});

test('players parse with names and positions', () => {
  const rows = playerRows(boxscore(2025, 1));
  assert.ok(rows.length > 100, `expected a full player pool, got ${rows.length}`);
  assert.ok(rows.every((p) => p.full_name.length > 0));
  // 1=QB 2=RB 3=WR 4=TE 5=K 16=D/ST, derived in exploration, not assumed.
  const positions = new Set(rows.map((p) => p.default_position_id));
  for (const pos of [1, 2, 3, 4, 5, 16]) {
    assert.ok(positions.has(pos), `no players at position ${pos}`);
  }
});

test('completeness gate: played seasons are complete, 2026 is not', () => {
  for (const season of PLAYED) {
    const done = completedWeeks(history(season));
    assert.ok(done.length >= 14, `${season}: only ${done.length} completed weeks`);
  }
  // The live season has a schedule but no results -- must NOT look complete.
  const live = JSON.parse(readFileSync(join(ROOT, 'exploration/raw/2026_mMatchupScore.json'), 'utf8')) as EspnLeague;
  live.seasonId ??= 2026;
  const c = weekCompleteness(live, 1);
  assert.equal(c.complete, false, '2026 week 1 must not be considered complete');
  assert.ok(c.reason?.includes('undecided'), `unexpected reason: ${c.reason}`);
});

test('completeness gate: a week with no matchups is not "complete"', () => {
  const league = history(2025);
  const c = weekCompleteness(league, 99);
  assert.equal(c.complete, false);
  assert.match(c.reason ?? '', /no matchups/);
});

test('week rows carry kickoff times and flag TBD weeks', () => {
  const games = [
    { id: 1, scoringPeriodId: 1, date: 1789431300000, homeProTeamId: 1, awayProTeamId: 2, startTimeTBD: false },
    { id: 2, scoringPeriodId: 1, date: 1789000000000, homeProTeamId: 3, awayProTeamId: 4, startTimeTBD: false },
    { id: 3, scoringPeriodId: 16, date: 1799000000000, homeProTeamId: 5, awayProTeamId: 6, startTimeTBD: true },
  ];
  const rows = weekRows(2026, games, 14);
  const wk1 = rows.find((r) => r.week === 1)!;
  assert.equal(wk1.first_kickoff_at, new Date(1789000000000).toISOString(), 'first kickoff must be the EARLIEST game');
  assert.equal(wk1.has_tbd_kickoff, false);
  assert.equal(wk1.is_playoff, false);
  const wk16 = rows.find((r) => r.week === 16)!;
  assert.equal(wk16.has_tbd_kickoff, true, 'flex-scheduled week must be flagged');
  assert.equal(wk16.is_playoff, true);
});

test('starterCount sums slot multiplicities, unlike starterSlots.size', () => {
  const league = history(2025);
  const ids = starterSlots(league).size;
  const players = starterCount(league);
  assert.ok(players > ids,
    `this league starts multiples of some slots, so ${players} should exceed ${ids}`);
  // And the per-slot map must reconcile with the total.
  let summed = 0;
  for (const n of starterSlotCounts(league).values()) summed += n;
  assert.equal(summed, players);
});

test('final scoring period comes from the league, not a constant', () => {
  for (const season of PLAYED) {
    assert.ok(finalScoringPeriod(history(season)) >= 16);
  }
});
