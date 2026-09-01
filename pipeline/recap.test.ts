import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderWeeklyRecap, recapSubject, ordinal, signed, movementLabel, lean,
  type WeeklyRecap,
} from './recap.ts';

/** A full week, every optional section populated. */
const full: WeeklyRecap = {
  season: 2026,
  week: 3,
  games: [{
    espn_matchup_id: 12,
    away_name: 'Run & Hide', away_points: '101.2',
    home_name: 'The <Penguins>', home_points: '111.7', winner: 'HOME',
    detail: {
      surprise: {
        team: 'The <Penguins>', player: 'Josh Allen',
        projected: '20.9', actual: '36.3', delta: '15.4',
      },
      worstDecision: {
        team: 'Run & Hide', player: 'Jerry Jeudy',
        benchPoints: '16.1', worstStarter: '-6.0', cost: '37.4',
      },
      differentiator: {
        position: 'WR', homePoints: '62.3', awayPoints: '42.6', gap: '19.7',
      },
    },
  }],
  awards: [{ award_key: 'high_scorer', name: 'The <Penguins>', value: '111.7' }],
  bench: [{ name: 'Run & Hide', points_for: '101.2', optimal_points: '119.8', points_left_on_bench: '18.6' }],
  standings: [{ name: 'The <Penguins>', wins: 3, losses: 0, ties: 0, points_for: '340.1' }],
  predictions: [{ display_name: 'Ryan', correct: 8, points: '8', accuracy: '0.8' }],
  power: [
    { name: 'The <Penguins>', rank: 1, score: '88.4', movement: 2 },
    { name: 'Run & Hide', rank: 2, score: '71.0', movement: -1 },
  ],
  nextWeek: [{
    away_name: 'Run & Hide', home_name: 'The <Penguins>',
    away_score: '71.0', home_score: '88.4',
  }],
  luck: [
    { name: 'The <Penguins>', luck: '2.3', wins: 3, losses: 0 },
    { name: 'Run & Hide', luck: '-1.7', wins: 1, losses: 2 },
  ],
  allPlay: [{ name: 'The <Penguins>', all_play_wins: 24, all_play_losses: 3, wins: 3, losses: 0, pct: '0.8889' }],
  streaks: [{ name: 'The <Penguins>', result: 'W', length: 3 }],
  grudge: {
    team: 'Run & Hide', opponent: 'The <Penguins>',
    games: 19, wins: 8, losses: 11, ties: 0, first_season: 2018,
  },
  history: [{ label: 'Closest', season: 2022, detail: 'Panda Bear edged Brightleaf 137.0-136.7' }],
  recordWatch: [{ name: 'The <Penguins>', points: '194.5', all_time_rank: 1 }],
  disputed: {
    home_name: 'The <Penguins>', away_name: 'Run & Hide',
    home_votes: 4, away_votes: 3, winner: 'HOME',
  },
};

/** The same week with every conditional section empty -- the ordinary Tuesday. */
const quiet: WeeklyRecap = {
  ...full,
  games: [{ ...full.games[0]!, detail: null }],
  recordWatch: [],
  disputed: null,
  grudge: null,
  history: [],
  streaks: [],
  allPlay: [],
  luck: [],
  power: [],
  nextWeek: [],
};

const SITE = 'https://grudge.planitnow.us/';

test('every section renders when the week has one', () => {
  const { html, text } = renderWeeklyRecap(full, SITE);
  for (const heading of [
    'The week', 'Record watch', 'Power rankings', 'Week 4', 'Luck report',
    'Streaks', 'All-play', 'Most disputed pick', 'The Grudge',
    'This week in Grudge history', 'Awards', 'Standings', 'Prediction leaders',
  ]) {
    assert.ok(html.includes(heading), `missing HTML section: ${heading}`);
  }
  for (const heading of [
    'THE WEEK', 'RECORD WATCH', 'POWER RANKINGS', 'WEEK 4', 'LUCK REPORT',
    'STREAKS', 'ALL-PLAY', 'MOST DISPUTED PICK', 'THE GRUDGE',
    'THIS WEEK IN GRUDGE HISTORY', 'STANDINGS',
  ]) {
    assert.ok(text.includes(heading), `missing text section: ${heading}`);
  }
});

test('a quiet week prints no heading it cannot fill', () => {
  // The whole point of the conditional sections: a record watch that fires
  // every week is not a record watch, and an empty table under a heading is
  // worse than no heading at all.
  const { html, text } = renderWeeklyRecap(quiet, SITE);
  for (const heading of [
    'Record watch', 'Most disputed pick', 'The Grudge',
    'This week in Grudge history', 'Streaks', 'All-play', 'Luck report',
    'Power rankings',
  ]) {
    assert.ok(!html.includes(heading), `rendered an empty section: ${heading}`);
  }
  for (const heading of ['RECORD WATCH', 'MOST DISPUTED PICK', 'THE GRUDGE', 'STREAKS']) {
    assert.ok(!text.includes(heading), `rendered an empty text section: ${heading}`);
  }
  // What always survives.
  assert.ok(html.includes('Standings'));
  assert.ok(html.includes('The week'));
});

test('per-matchup detail names the player, the cost, and the position', () => {
  const { html, text } = renderWeeklyRecap(full, SITE);
  assert.match(html, /Josh Allen/);
  assert.match(html, /projected 20\.9/);
  assert.match(html, /\+15\.4/);          // the surprise, signed
  assert.match(html, /Jerry Jeudy/);
  assert.match(html, /worst starter managed -6\.0/);
  assert.match(html, /Decided at WR/);

  assert.match(text, /Surprise: Josh Allen/);
  assert.match(text, /cost 37\.4/);
  assert.match(text, /Decided at WR/);
});

test('a matchup with no detail still renders its score', () => {
  const { html } = renderWeeklyRecap(quiet, SITE);
  assert.match(html, /101\.2/);
  assert.match(html, /111\.7/);
  assert.doesNotMatch(html, /Surprise/);
});

test('league data is HTML-escaped, and left alone in the text alternative', () => {
  const { html, text } = renderWeeklyRecap(full, SITE);
  assert.match(html, /The &lt;Penguins&gt;/);
  assert.doesNotMatch(html, /The <Penguins>/);
  assert.match(text, /Run & Hide 101\.2 at The <Penguins> 111\.7/);
  assert.match(text, /Full recap: https:\/\/grudge\.planitnow\.us/);
});

test("the subject leads with the week's top performance, and falls back cleanly", () => {
  assert.equal(recapSubject(full), 'Week 3: The <Penguins> drops 111.7');
  assert.equal(
    recapSubject({ ...full, awards: [] }),
    'UNC Grudge Match — Week 3 recap'
  );
});

test('the public recap link must be HTTPS', () => {
  assert.throws(() => renderWeeklyRecap(full, 'http://example.com'), /must use HTTPS/);
});

test('the Saturday lock is stated in the email, not just enforced', () => {
  const { html, text } = renderWeeklyRecap(full, SITE);
  assert.match(html, /lock Saturday at midnight ET/);
  assert.match(text, /lock Saturday at midnight ET/);
});

test('ordinal handles the teens, which are the ones that break', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');
});

test('signed marks a gain and leaves a loss alone', () => {
  assert.equal(signed('15.4'), '+15.4');
  assert.equal(signed('-6.0'), '-6.0');
  assert.equal(signed('0'), '0');
});

test('movement is an arrow, and blank for a team new to the rankings', () => {
  assert.equal(movementLabel(2), '▲2');
  assert.equal(movementLabel(-1), '▼1');
  assert.equal(movementLabel(0), '—');
  assert.equal(movementLabel(null), '—');
});

test('the lean names a favourite only when the rankings actually separate them', () => {
  assert.deepEqual(
    lean({ away_name: 'A', home_name: 'B', away_score: '71.0', home_score: '88.4' }),
    { name: 'B', margin: '17.4' }
  );
  assert.deepEqual(
    lean({ away_name: 'A', home_name: 'B', away_score: '88.4', home_score: '71.0' }),
    { name: 'A', margin: '17.4' }
  );
  // Level, or unranked: no favourite rather than a coin-flip dressed as one.
  assert.equal(lean({ away_name: 'A', home_name: 'B', away_score: '80.0', home_score: '80.0' }), null);
  assert.equal(lean({ away_name: 'A', home_name: 'B', away_score: null, home_score: '80.0' }), null);
});
