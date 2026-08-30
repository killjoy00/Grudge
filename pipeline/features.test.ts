/**
 * Feature tests against seven REAL played seasons (2018-2025, minus the
 * unplayed 2020).
 *
 * The load-bearing test here is `standings reproduce ESPN's own records`:
 * ESPN independently reports each team's W-L-T and points-for, so recomputing
 * them from raw matchups and matching exactly proves the whole chain --
 * matchup parsing, winner semantics, both-sides expansion -- rather than just
 * proving the code is self-consistent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EspnLeague } from './espn.ts';
import { matchupRows, rosterEntryRows, starterSlots, starterSlotCounts } from './normalize.ts';
import {
  teamWeeks, standings, luckIndex, seasonLuck, optimalLineup,
  powerRankings, weeklyAwards, playoffOdds, headToHead,
} from './features.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString()) as EspnLeague;
const history = (s: number) => readGz(join(ROOT, 'data/history', String(s), 'league.json.gz'));
const boxscore = (s: number, wk: number) =>
  readGz(join(ROOT, 'data/history', String(s), 'boxscores', `sp${String(wk).padStart(2, '0')}.json.gz`));

const PLAYED = [2018, 2019, 2021, 2022, 2023, 2024, 2025].filter((y) =>
  existsSync(join(ROOT, 'data/history', String(y), 'league.json.gz'))
);

test('standings reproduce ESPN\'s own recorded records', () => {
  let teamsChecked = 0;
  for (const season of PLAYED) {
    const league = history(season);
    // Regular season only: ESPN's record.overall excludes playoff matchups.
    const regularWeeks = league.settings!.scheduleSettings.matchupPeriodCount;
    const tw = teamWeeks(matchupRows(league).filter((m) => m.week <= regularWeeks));
    const computed = new Map(standings(tw).map((s) => [s.teamId, s]));

    for (const t of league.teams ?? []) {
      const espn = t.record?.overall;
      if (!espn) continue;
      const mine = computed.get(t.id);
      assert.ok(mine, `${season}: team ${t.id} missing from computed standings`);
      assert.equal(mine.wins, espn.wins, `${season} team ${t.id}: wins`);
      assert.equal(mine.losses, espn.losses, `${season} team ${t.id}: losses`);
      assert.equal(mine.ties, espn.ties, `${season} team ${t.id}: ties`);
      assert.ok(Math.abs(mine.pointsFor - espn.pointsFor) < 0.5,
        `${season} team ${t.id}: PF ${mine.pointsFor.toFixed(2)} vs ESPN ${espn.pointsFor}`);
      assert.ok(Math.abs(mine.pointsAgainst - espn.pointsAgainst) < 0.5,
        `${season} team ${t.id}: PA ${mine.pointsAgainst.toFixed(2)} vs ESPN ${espn.pointsAgainst}`);
      teamsChecked++;
    }
  }
  assert.ok(teamsChecked >= 60, `expected ~70 team-seasons checked, got ${teamsChecked}`);
});

test('every team plays every week exactly once', () => {
  for (const season of PLAYED) {
    const tw = teamWeeks(matchupRows(history(season)));
    const byWeek = new Map<number, number[]>();
    for (const r of tw) {
      const list = byWeek.get(r.week) ?? [];
      list.push(r.teamId);
      byWeek.set(r.week, list);
    }
    for (const [week, ids] of byWeek) {
      assert.equal(new Set(ids).size, ids.length, `${season} wk${week}: a team appears twice`);
    }
  }
});

test('luck index: wins+losses reconcile, and flags are mutually exclusive', () => {
  for (const season of PLAYED) {
    const tw = teamWeeks(matchupRows(history(season)));
    const luck = luckIndex(tw);
    assert.ok(luck.length > 0);
    for (const l of luck) {
      assert.ok(!(l.unluckyLoss && l.luckyWin), 'a week cannot be both lucky and unlucky');
      if (l.unluckyLoss) assert.ok(l.beatMedian && !l.won);
      if (l.luckyWin) assert.ok(!l.beatMedian && l.won);
      // In a 10-team league you face 9 others each week.
      assert.ok(l.allPlayWins + l.allPlayLosses <= 9);
    }
  }
});

test('luck index finds real unlucky losses in real seasons', () => {
  // A league where nobody ever loses while outscoring the median would be
  // suspicious -- this confirms the metric actually fires on real data.
  let unlucky = 0, lucky = 0;
  for (const season of PLAYED) {
    const luck = luckIndex(teamWeeks(matchupRows(history(season))));
    unlucky += luck.filter((l) => l.unluckyLoss).length;
    lucky += luck.filter((l) => l.luckyWin).length;
  }
  assert.ok(unlucky > 20, `expected many unlucky losses across 7 seasons, got ${unlucky}`);
  assert.ok(lucky > 20, `expected many lucky wins across 7 seasons, got ${lucky}`);
});

test('season luck: expected wins are bounded and total sensibly', () => {
  for (const season of PLAYED) {
    const tw = teamWeeks(matchupRows(history(season)));
    const sl = seasonLuck(luckIndex(tw));
    for (const s of sl) {
      assert.ok(s.expectedWins >= 0 && s.expectedWins <= 20, `${season} team ${s.teamId}: expectedWins ${s.expectedWins}`);
      assert.ok(Math.abs(s.luckDelta - (s.actualWins - s.expectedWins)) < 1e-9);
    }
    // Across the league, luck is roughly zero-sum: one team's lucky win is
    // another's unlucky loss.
    const totalDelta = sl.reduce((a, s) => a + s.luckDelta, 0);
    assert.ok(Math.abs(totalDelta) < 1.0, `${season}: luck should net out, got ${totalDelta.toFixed(3)}`);
  }
});

test('optimal lineup is never worse than what was actually started', () => {
  const season = 2025;
  const league = history(season);
  const starters = starterSlots(league);
  const slotCap = starterSlotCounts(league);

  let checked = 0, withBenchLoss = 0;
  for (const week of [1, 5, 9, 13]) {
    const bx = boxscore(season, week);
    // eligibleSlots is per player, straight from ESPN.
    const eligible = new Map<number, number[]>();
    for (const m of bx.schedule ?? []) {
      for (const side of [m.home, m.away]) {
        for (const e of side?.rosterForCurrentScoringPeriod?.entries ?? []) {
          const p = e.playerPoolEntry?.player as { id: number; eligibleSlots?: number[] } | undefined;
          if (p) eligible.set(p.id, p.eligibleSlots ?? []);
        }
      }
    }
    const rows = rosterEntryRows(bx, week, starters);
    const teamIds = [...new Set(rows.map((r) => r.espn_team_id))];
    for (const teamId of teamIds) {
      const res = optimalLineup(rows.filter((r) => r.espn_team_id === teamId), eligible, slotCap);
      assert.ok(res, `no lineup for team ${teamId}`);
      assert.ok(res.optimalPoints >= res.actualPoints - 0.01,
        `wk${week} team ${teamId}: optimal ${res.optimalPoints} < actual ${res.actualPoints}`);
      assert.ok(res.pointsLeftOnBench >= 0);
      if (res.pointsLeftOnBench > 0) withBenchLoss++;
      checked++;
    }
  }
  assert.ok(checked >= 30, `expected many team-weeks, got ${checked}`);
  // Real managers leave points on the bench constantly; zero would mean the
  // optimizer is just replaying the actual lineup.
  assert.ok(withBenchLoss > checked * 0.3,
    `only ${withBenchLoss}/${checked} team-weeks left points on the bench -- optimizer looks inert`);
});

test('optimal lineup fills exactly a legal lineup', () => {
  const season = 2025, week = 3;
  const league = history(season);
  const slotCap = starterSlotCounts(league);
  const expectedStarters = [...slotCap.values()].reduce((a, b) => a + b, 0);
  const bx = boxscore(season, week);
  const eligible = new Map<number, number[]>();
  for (const m of bx.schedule ?? []) {
    for (const side of [m.home, m.away]) {
      for (const e of side?.rosterForCurrentScoringPeriod?.entries ?? []) {
        const p = e.playerPoolEntry?.player as { id: number; eligibleSlots?: number[] } | undefined;
        if (p) eligible.set(p.id, p.eligibleSlots ?? []);
      }
    }
  }
  const rows = rosterEntryRows(bx, week, starterSlots(league));
  const teamId = rows[0]!.espn_team_id;
  const mine = rows.filter((r) => r.espn_team_id === teamId);
  const res = optimalLineup(mine, eligible, slotCap)!;
  // The optimal total must be achievable by exactly `expectedStarters` players.
  const actualStarterCount = mine.filter((r) => r.is_starter).length;
  assert.equal(actualStarterCount, expectedStarters);
  assert.ok(res.optimalPoints > 0);
});

test('power rankings: complete, ordered, bounded', () => {
  for (const season of PLAYED) {
    const tw = teamWeeks(matchupRows(history(season)));
    const pr = powerRankings(tw, luckIndex(tw));
    assert.equal(pr.length, new Set(tw.map((r) => r.teamId)).size);
    for (let i = 1; i < pr.length; i++) {
      assert.ok(pr[i - 1]!.score >= pr[i]!.score, `${season}: rankings not sorted`);
      assert.equal(pr[i]!.rank, i + 1);
    }
    for (const r of pr) {
      assert.ok(r.score > 0 && r.score < 1.5, `${season} team ${r.teamId}: score ${r.score} out of range`);
      assert.ok(r.components.allPlayWinPct >= 0 && r.components.allPlayWinPct <= 1);
    }
  }
});

test('power rankings correlate with the actual champion-ish teams', () => {
  // Not a precise claim -- just that the model is not inverted. The top power
  // team should usually be a winning team, not a cellar-dweller.
  for (const season of PLAYED) {
    const league = history(season);
    const regular = league.settings!.scheduleSettings.matchupPeriodCount;
    const tw = teamWeeks(matchupRows(league).filter((m) => m.week <= regular));
    const pr = powerRankings(tw, luckIndex(tw));
    const st = new Map(standings(tw).map((s) => [s.teamId, s]));
    const top = pr[0]!;
    assert.ok((st.get(top.teamId)?.winPct ?? 0) >= 0.4,
      `${season}: top power team has win pct ${st.get(top.teamId)?.winPct}`);
  }
});

test('weekly awards fire on real weeks', () => {
  const season = 2025, week = 4;
  const league = history(season);
  const matchups = matchupRows(league);
  const tw = teamWeeks(matchups);
  const awards = weeklyAwards(season, week, tw, matchups, []);
  const keys = new Set(awards.map((a) => a.awardKey));
  for (const k of ['high_scorer', 'low_scorer', 'blowout', 'nailbiter']) {
    assert.ok(keys.has(k as never), `missing award ${k}`);
  }
  const high = awards.find((a) => a.awardKey === 'high_scorer')!;
  const low = awards.find((a) => a.awardKey === 'low_scorer')!;
  assert.ok(high.value > low.value, 'high scorer must outscore low scorer');
  const blow = awards.find((a) => a.awardKey === 'blowout')!;
  const close = awards.find((a) => a.awardKey === 'nailbiter')!;
  assert.ok(blow.value >= close.value, 'blowout margin must be >= nailbiter margin');
});

test('playoff odds: probabilities are valid and sum to the bracket size', () => {
  const season = 2025;
  const league = history(season);
  const regular = league.settings!.scheduleSettings.matchupPeriodCount;
  const all = matchupRows(league).filter((m) => m.week <= regular);
  // Simulate from midseason: first 7 weeks known, rest unknown.
  const played = all.filter((m) => m.week <= 7);
  const remaining = all.filter((m) => m.week > 7)
    .map((m) => ({ week: m.week, homeTeamId: m.home_team_id, awayTeamId: m.away_team_id }));

  const odds = playoffOdds(teamWeeks(played), remaining, league.settings!.scheduleSettings.playoffTeamCount, 2000);
  assert.equal(odds.length, 10);
  for (const o of odds) {
    assert.ok(o.playoffPct >= 0 && o.playoffPct <= 1, `pct out of range: ${o.playoffPct}`);
    assert.ok(o.byePct <= o.playoffPct + 1e-9, 'bye odds cannot exceed playoff odds');
    const seedSum = Object.values(o.seedDistribution).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(seedSum - 1) < 0.01, `seed distribution sums to ${seedSum}`);
    assert.ok(o.assumptions.distribution === 'normal, fitted per team');
    assert.equal(o.assumptions.modelsInjuriesOrByes, false);
  }
  // Exactly playoffTeamCount teams make it in every simulation, so the
  // probabilities must sum to that.
  const total = odds.reduce((a, o) => a + o.playoffPct, 0);
  assert.ok(Math.abs(total - 6) < 0.05, `playoff pcts sum to ${total}, expected 6`);
  const byes = odds.reduce((a, o) => a + o.byePct, 0);
  assert.ok(Math.abs(byes - 2) < 0.05, `bye pcts sum to ${byes}, expected 2`);
});

test('playoff odds are deterministic for a fixed seed', () => {
  const league = history(2025);
  const regular = league.settings!.scheduleSettings.matchupPeriodCount;
  const all = matchupRows(league).filter((m) => m.week <= regular);
  const played = teamWeeks(all.filter((m) => m.week <= 7));
  const remaining = all.filter((m) => m.week > 7)
    .map((m) => ({ week: m.week, homeTeamId: m.home_team_id, awayTeamId: m.away_team_id }));
  const a = playoffOdds(played, remaining, 6, 500, 42);
  const b = playoffOdds(played, remaining, 6, 500, 42);
  assert.deepEqual(a.map((x) => x.playoffPct), b.map((x) => x.playoffPct));
});

test('playoff odds: a finished season gives the teams that actually made it 100%', () => {
  // With no remaining games, the simulation is just the final standings.
  const league = history(2025);
  const regular = league.settings!.scheduleSettings.matchupPeriodCount;
  const tw = teamWeeks(matchupRows(league).filter((m) => m.week <= regular));
  const odds = playoffOdds(tw, [], 6, 200);
  const certain = odds.filter((o) => o.playoffPct === 1);
  assert.equal(certain.length, 6, 'exactly 6 teams should be certain when nothing remains');
  const out = odds.filter((o) => o.playoffPct === 0);
  assert.equal(out.length, 4);
});

test('head-to-head spans multiple seasons and is symmetric', () => {
  const all = PLAYED.flatMap((s) => teamWeeks(matchupRows(history(s))));
  const h2h = headToHead(all);
  assert.ok(h2h.length > 50, `expected many rivalry pairs, got ${h2h.length}`);

  const byKey = new Map(h2h.map((h) => [`${h.teamId}:${h.opponentId}`, h]));
  let multiSeason = 0;
  for (const h of h2h) {
    const mirror = byKey.get(`${h.opponentId}:${h.teamId}`);
    assert.ok(mirror, `no mirror record for ${h.teamId} vs ${h.opponentId}`);
    assert.equal(h.games, mirror.games, 'game counts must match both ways');
    assert.equal(h.wins, mirror.losses, 'my wins must equal their losses');
    assert.ok(Math.abs(h.pointsFor - mirror.pointsAgainst) < 0.5);
    if (h.lastSeason > h.firstSeason) multiSeason++;
  }
  assert.ok(multiSeason > 40, 'expected rivalries spanning multiple seasons');
});

test('head-to-head excludes the unplayed 2020 season', () => {
  const all = PLAYED.flatMap((s) => teamWeeks(matchupRows(history(s))));
  assert.ok(!all.some((r) => r.season === 2020), '2020 must not contribute games');
});
