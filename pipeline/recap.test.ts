import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderWeeklyRecap, recapSubject, ordinal, signed, movementLabel, lean,
  introFor, grudgeLine,
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
        benchPoints: '16.1', displaced: 'George Pickens',
        displacedPoints: '4.7', cost: '11.4',
      },
      differentiator: {
        position: 'WR', homePoints: '62.3', awayPoints: '42.6', gap: '19.7',
      },
    },
  }],
  awards: [
    { award_key: 'high_scorer', name: 'The <Penguins>', value: '111.7', against: null },
    { award_key: 'nailbiter', name: 'Run & Hide', value: '3.8', against: 'The <Penguins>' },
    { award_key: 'worst_bench', name: 'Run & Hide', value: '11.4', against: 'Jerry Jeudy' },
  ],
  bench: [{ name: 'Run & Hide', points_for: '101.2', optimal_points: '119.8', points_left_on_bench: '18.6' }],
  standings: [{ name: 'The <Penguins>', wins: 3, losses: 0, ties: 0, points_for: '340.1' }],
  predictions: [{ display_name: 'Ryan', correct: 8, points: '8', accuracy: '0.8' }],
  power: [
    { name: 'The <Penguins>', rank: 1, score: '88.4', movement: 2, playoff_pct: '94' },
    { name: 'Run & Hide', rank: 2, score: '71.0', movement: -1, playoff_pct: null },
  ],
  nextWeek: [{
    away_name: 'Run & Hide', home_name: 'The <Penguins>',
    away_score: '71.0', home_score: '88.4',
  }],
  luck: [
    { name: 'The <Penguins>', luck: '2.3', wins: 3, losses: 0 },
    { name: 'Run & Hide', luck: '-1.7', wins: 1, losses: 2 },
  ],
  allPlay: [{
    name: 'The <Penguins>', all_play_wins: 24, all_play_losses: 3,
    wins: 3, losses: 0, games: 3, pct: '0.8889',
    scaled_wins: '2.7', scaled_losses: '0.3',
  }],
  streaks: [{ name: 'The <Penguins>', result: 'W', length: 4 }],
  grudge: {
    home: 'The <Penguins>', away: 'Run & Hide', winner: 'AWAY',
    games: 19, wins: 8, losses: 11, ties: 0, first_season: 2018,
  },
  history: [{ label: 'Closest ever', season: 2022, detail: 'Panda Bear edged Brightleaf 137.0-136.7 — by 0.3' }],
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
    'This week&rsquo;s games', 'Record watch', 'Power rankings', 'Week 4', 'Luck report',
    'Streaks', 'All-play', 'Most disputed pick', 'The Grudge',
    'This week in Grudge Match history', 'Awards', 'Standings', 'Prediction leaders',
  ]) {
    assert.ok(html.includes(heading), `missing HTML section: ${heading}`);
  }
  for (const heading of [
    "THIS WEEK'S GAMES", 'RECORD WATCH', 'POWER RANKINGS', 'WEEK 4', 'LUCK REPORT',
    'STREAKS', 'ALL-PLAY', 'MOST DISPUTED PICK', 'THE GRUDGE',
    'THIS WEEK IN GRUDGE MATCH HISTORY', 'STANDINGS',
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
    'This week in Grudge Match history', 'Streaks', 'All-play', 'Luck report',
    'Power rankings',
  ]) {
    assert.ok(!html.includes(heading), `rendered an empty section: ${heading}`);
  }
  for (const heading of ['RECORD WATCH', 'MOST DISPUTED PICK', 'THE GRUDGE', 'STREAKS']) {
    assert.ok(!text.includes(heading), `rendered an empty text section: ${heading}`);
  }
  // What always survives.
  assert.ok(html.includes('Standings'));
  assert.ok(html.includes('This week&rsquo;s games'));
});

test('per-matchup detail names the player, the cost, and the position', () => {
  const { html, text } = renderWeeklyRecap(full, SITE);
  assert.match(html, /Josh Allen/);
  assert.match(html, /projected 20\.9/);
  assert.match(html, /\+15\.4/);          // the surprise, signed
  assert.match(html, /Jerry Jeudy/);
  assert.match(html, /started George Pickens \(4\.7\)/);
  assert.match(html, /Decided at WR/);

  assert.match(text, /Surprise: Josh Allen/);
  assert.match(text, /11\.4 left on the bench/);
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
  assert.match(text, /Full site: https:\/\/grudge\.planitnow\.us/);
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

test('the intro rotates but is stable for a given week', () => {
  // Stability matters more than variety: a delivery retry must not produce a
  // different email from the one some of the league already received.
  assert.equal(introFor(3), introFor(3));
  const seen = new Set([1, 2, 3, 4, 5, 6, 7].map(introFor));
  assert.ok(seen.size > 1, 'every week produced the same opener');
  assert.ok(introFor(99).length > 0, 'a late week must still get an opener');
});

test('the grudge quotes the series from whoever is actually ahead', () => {
  const base = {
    home: 'Home', away: 'Away', games: 19, ties: 0, first_season: 2018,
  };
  // Home is 8-11, so AWAY leads -- the old wording claimed the home team did.
  assert.match(
    grudgeLine({ ...base, winner: 'AWAY', wins: 8, losses: 11 }),
    /Away took it\. All time, Away lead it 11-8\./
  );
  assert.match(
    grudgeLine({ ...base, winner: 'HOME', wins: 11, losses: 8 }),
    /Home took it\. All time, Home lead it 11-8\./
  );
  assert.match(
    grudgeLine({ ...base, winner: 'TIE', wins: 9, losses: 9 }),
    /They tied\. All time, it is level at 9-9\./
  );
});

test('playoff odds ride along with the rankings, and tolerate having none', () => {
  const { html, text } = renderWeeklyRecap(full, SITE);
  assert.match(html, /94%/);
  assert.match(text, /94% playoffs/);
  // The unranked-for-odds team must render a dash, not "null%".
  assert.doesNotMatch(html, /null/);
  assert.doesNotMatch(text, /null/);
});

test('the power rankings link out to the methodology', () => {
  const { html } = renderWeeklyRecap(full, SITE);
  assert.match(html, /https:\/\/grudge\.planitnow\.us\/rankings/);
});

test('all-play is reported on the same scale as the real record', () => {
  // 24-3 over three weeks is nine games a week; nobody can hold that against
  // a 3-0 without doing arithmetic. Scaled, it reads 2.7-0.3.
  const { html, text } = renderWeeklyRecap(full, SITE);
  assert.match(html, /2\.7-0\.3/);
  assert.match(html, /\(24-3\)/);          // the raw figure survives, in brackets
  assert.match(text, /2\.7-0\.3 all-play/);
  assert.match(text, /24-3 raw/);
});

test('awards name the other party where there is one', () => {
  const { html, text } = renderWeeklyRecap(full, SITE);
  assert.match(html, /lost to The &lt;Penguins&gt;/);
  assert.match(html, /benched Jerry Jeudy/);
  assert.match(text, /lost to The <Penguins>/);
  assert.match(text, /benched Jerry Jeudy/);
  // An award with no counterpart gets no empty brackets.
  assert.doesNotMatch(html, /Highest score<\/td><td[^>]*><strong>[^<]*<\/strong><span[^>]*> \(\)/);
});

test("next week closes the letter rather than interrupting it", () => {
  const { html, text } = renderWeeklyRecap(full, SITE);
  // It must come after the standings, not before them.
  assert.ok(html.indexOf('Week 4') > html.indexOf('Standings'),
    'the Week 4 preview should sit at the end of the email');
  assert.ok(text.indexOf('COMING UP — WEEK 4') > text.indexOf('STANDINGS'));
});
