import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRecipients, renderWeeklyRecap, type WeeklyRecap } from './recap.ts';

const recap: WeeklyRecap = {
  season: 2026,
  week: 3,
  games: [{
    away_name: 'Run & Hide', away_points: '101.2',
    home_name: 'The <Penguins>', home_points: '111.7', winner: 'HOME',
  }],
  awards: [{ award_key: 'high_scorer', name: 'The <Penguins>', value: '111.7' }],
  bench: [{ name: 'Run & Hide', points_for: '101.2', optimal_points: '119.8', points_left_on_bench: '18.6' }],
  standings: [{ name: 'The <Penguins>', wins: 3, losses: 0, ties: 0, points_for: '340.1' }],
  predictions: [{ display_name: 'Ryan', correct: 8, points: '8', accuracy: '0.8' }],
};

test('recipient parsing normalizes, deduplicates, and accepts common separators', () => {
  assert.deepEqual(
    parseRecipients('Ryan@Example.com, friend@example.com\nRYAN@example.com;third@example.com'),
    ['ryan@example.com', 'friend@example.com', 'third@example.com']
  );
});

test('recipient parsing rejects malformed values without echoing them', () => {
  assert.throws(() => parseRecipients('good@example.com,not-an-email'), {
    message: 'RECAP_RECIPIENTS contains an invalid email address.',
  });
});

test('the recap contains each section, a text alternative, and escaped league data', () => {
  const rendered = renderWeeklyRecap(recap, 'https://grudge.planitnow.us/');
  assert.equal(rendered.subject, 'UNC Grudge Match — Week 3 recap');
  assert.match(rendered.html, /Results/);
  assert.match(rendered.html, /Awards/);
  assert.match(rendered.html, /Bench watch/);
  assert.match(rendered.html, /Standings/);
  assert.match(rendered.html, /Prediction leaders/);
  assert.match(rendered.html, /The &lt;Penguins&gt;/);
  assert.doesNotMatch(rendered.html, /The <Penguins>/);
  assert.match(rendered.text, /Run & Hide 101\.2 at The <Penguins> 111\.7/);
  assert.match(rendered.text, /Full recap: https:\/\/grudge\.planitnow\.us/);
});

test('the public recap link must be HTTPS', () => {
  assert.throws(() => renderWeeklyRecap(recap, 'http://example.com'), /must use HTTPS/);
});
