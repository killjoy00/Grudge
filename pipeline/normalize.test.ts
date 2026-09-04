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
  finalScoringPeriod, BENCH_SLOT, IR_SLOT, transactionRows,
  matchupProjectionRows, draftPickRows,
} from './normalize.ts';
import type { EspnDraftDetail } from './espn.ts';

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

test('a transaction with no status survives, because ESPN sends some that way', () => {
  // The bug this pins cost a whole weekly run. transactions.status was written
  // not-null on a sample that was entirely DRAFT records, every one of which
  // carries 'EXECUTED'. A TRADE_ACCEPT carries no status at all, and the first
  // accepted trade of the 2026 preseason failed the load.
  const league = {
    seasonId: 2026,
    transactions: [
      { id: 'a', type: 'DRAFT', status: 'EXECUTED', scoringPeriodId: 1, teamId: 4 },
      // The real shape, from ESPN: no `status` key at all.
      { id: 'b', type: 'TRADE_ACCEPT', executionType: 'EXECUTE', isPending: false,
        scoringPeriodId: 1, teamId: 9, items: [] },
    ],
  } as unknown as EspnLeague;

  const rows = transactionRows(league, new Set([1]));
  assert.equal(rows.length, 2, 'a status-less transaction must not be dropped');
  const accept = rows.find((r) => r.espn_transaction_id === 'b');
  assert.ok(accept);
  assert.equal(accept.status, null, 'null records that ESPN did not say');
  assert.equal(accept.type, 'TRADE_ACCEPT');
  assert.equal(accept.bid_amount, 0);
});

test('a transaction with no type is skipped, not stored unclassifiable', () => {
  const league = {
    seasonId: 2026,
    transactions: [{ id: 'x', status: 'EXECUTED', scoringPeriodId: 1 }],
  } as unknown as EspnLeague;
  assert.equal(transactionRows(league, new Set([1])).length, 0);
});

test('transactions outside the known weeks are left alone', () => {
  const league = {
    seasonId: 2026,
    transactions: [
      { id: 'a', type: 'DRAFT', status: 'EXECUTED', scoringPeriodId: 1 },
      { id: 'b', type: 'DRAFT', status: 'EXECUTED', scoringPeriodId: 99 },
    ],
  } as unknown as EspnLeague;
  const rows = transactionRows(league, new Set([1]));
  assert.deepEqual(rows.map((r) => r.espn_transaction_id), ['a']);
});

test('every archived season normalizes its transactions without a null type', () => {
  // Against the real payloads: type is the discriminator and must never be
  // null in a stored row, whatever new envelope shapes ESPN introduces.
  for (const season of PLAYED) {
    const league = history(season);
    const weeks = new Set((league.schedule ?? []).map((m) => m.matchupPeriodId));
    for (const row of transactionRows(league, weeks)) {
      assert.ok(row.type, `${season}: stored a transaction with no type`);
      assert.equal(typeof row.raw, 'string');
    }
  }
});

/* ------------------------------------------------ the week ahead: ESPN's own */

test('ESPN projections total the starting lineup, against real payloads', () => {
  // Run over played weeks because those are the archived payloads we have.
  // The arithmetic is identical for an unplayed week -- statSourceId 1 is
  // served either way -- and this checks the part that could actually be
  // wrong: which entries are summed.
  //
  // NOT every archived season carries real projections. 2023 serves
  // statSourceId 1 for every player with appliedTotal 0 -- ESPN stops backing
  // historical projections at some age. So the slot semantics are checked
  // everywhere and the magnitude only where there is a number to check, with a
  // guard below so that cannot quietly become nowhere.
  let seasonsWithProjections = 0;
  for (const season of PLAYED) {
    const league = history(season);
    const starters = starterSlots(league);
    const expected = starterCount(league);
    const rows = matchupProjectionRows(boxscore(season, 1), 1, starters);

    assert.ok(rows.length >= 8, `${season}: only ${rows.length} sides projected`);
    for (const row of rows) {
      // AT MOST the full lineup, not exactly it. Teams really do leave a
      // starting slot empty -- 2023 team 1 went into week 1 with no D/ST and
      // started nine. That is the case `starters` exists to record, so
      // asserting equality here would be asserting that managers are tidy.
      assert.ok(row.starters > 0 && row.starters <= expected,
        `${season} team ${row.espn_team_id}: counted ${row.starters} of at most ${expected}`);
      // A plausible fantasy total. The failure this guards is summing the
      // whole roster including the bench, which lands near double.
      assert.ok(row.projected_points < 250,
        `${season} team ${row.espn_team_id}: projected ${row.projected_points}, bench included?`);
    }
    // Most teams do field a full lineup, so a change that started dropping
    // legitimate starters would still be caught.
    assert.ok(rows.filter((r) => r.starters === expected).length >= rows.length - 2,
      `${season}: ${rows.filter((r) => r.starters < expected).length} sides short of a full lineup`);

    // Every side of every matchup in that week, and no duplicates.
    const ids = rows.map((r) => r.espn_team_id);
    assert.equal(new Set(ids).size, ids.length, `${season}: a team was projected twice`);

    if (rows.every((r) => r.projected_points > 0)) seasonsWithProjections++;
  }
  assert.ok(seasonsWithProjections >= 3,
    `only ${seasonsWithProjections} archived season(s) had real projections -- if this reaches ` +
    'zero the magnitude is no longer being checked anywhere');
});

test('the projection is the projection, not the score', () => {
  // Reading statSourceId 0 by mistake would pass every check above and turn
  // "what ESPN expected" into "what happened", which is the one thing this
  // feature must never do.
  const season = 2025;
  const league = history(season);
  const bx = boxscore(season, 1);
  const projected = matchupProjectionRows(bx, 1, starterSlots(league));
  const actual = new Map<number, number>();
  for (const m of bx.schedule ?? []) {
    if (m.matchupPeriodId !== 1) continue;
    for (const side of [m.home, m.away]) if (side) actual.set(side.teamId, side.totalPoints ?? 0);
  }
  const same = projected.filter((r) => Math.abs(r.projected_points - (actual.get(r.espn_team_id) ?? 0)) < 0.01);
  assert.equal(same.length, 0, 'a projected total exactly equalled the real score');
});

test('a side with no starting lineup is skipped, not projected at zero', () => {
  // Writing 0.0 would hand the opponent a free correct pick in ESPN's record.
  const bx = {
    seasonId: 2026,
    schedule: [{
      id: 1, matchupPeriodId: 1,
      home: { teamId: 1, rosterForCurrentScoringPeriod: { entries: [] } },
      away: {
        teamId: 2,
        rosterForCurrentScoringPeriod: {
          entries: [{
            playerId: 5, lineupSlotId: 2,
            playerPoolEntry: { player: { id: 5, fullName: 'X', stats: [
              { statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: 1, appliedTotal: 12.5 },
            ] } },
          }],
        },
      },
    }],
  } as unknown as EspnLeague;
  const rows = matchupProjectionRows(bx, 1, new Set([2]));
  assert.deepEqual(rows.map((r) => r.espn_team_id), [2]);
  assert.equal(rows[0]!.projected_points, 12.5);
});

test('a missing projection counts as zero from a starter who is still counted', () => {
  const bx = {
    seasonId: 2026,
    schedule: [{
      id: 1, matchupPeriodId: 1,
      home: {
        teamId: 1,
        rosterForCurrentScoringPeriod: {
          entries: [
            { playerId: 5, lineupSlotId: 2, playerPoolEntry: { player: { id: 5, fullName: 'A', stats: [
              { statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: 1, appliedTotal: 10 }] } } },
            // On a bye, or ESPN simply has no number for him. Expecting
            // nothing from a slot is a real prediction about that team.
            { playerId: 6, lineupSlotId: 2, playerPoolEntry: { player: { id: 6, fullName: 'B' } } },
            // Bench: never counted.
            { playerId: 7, lineupSlotId: 20, playerPoolEntry: { player: { id: 7, fullName: 'C', stats: [
              { statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: 1, appliedTotal: 99 }] } } },
          ],
        },
      },
    }],
  } as unknown as EspnLeague;
  const [row] = matchupProjectionRows(bx, 1, new Set([2]));
  assert.equal(row!.projected_points, 10);
  assert.equal(row!.starters, 2);
});

test('the draft board keeps team defences, whose ESPN ids are negative', () => {
  // -16034 is a D/ST, not a corrupt row. A `playerId > 0` filter drops exactly
  // one pick per team and does it silently.
  const detail = {
    draftDetail: {
      drafted: true,
      picks: [
        { overallPickNumber: 1, roundId: 1, roundPickNumber: 1, teamId: 10, playerId: 4429795 },
        { overallPickNumber: 112, roundId: 12, roundPickNumber: 2, teamId: 3, playerId: -16034 },
        { overallPickNumber: 113, roundId: 12, roundPickNumber: 3, teamId: 0, playerId: 0 },
      ],
    },
  } as EspnDraftDetail;
  const rows = draftPickRows(detail, 2026);
  assert.deepEqual(rows.map((r) => r.espn_player_id), [4429795, -16034]);
  assert.equal(rows[1]!.round, 12);
  assert.equal(rows[1]!.espn_team_id, 3);
});

test('an undrafted board is not loaded as a table full of nobody', () => {
  const detail = {
    draftDetail: {
      drafted: false,
      picks: [{ overallPickNumber: 1, roundId: 1, roundPickNumber: 1, teamId: 0, playerId: 0 }],
    },
  } as EspnDraftDetail;
  assert.deepEqual(draftPickRows(detail, 2026), []);
});
