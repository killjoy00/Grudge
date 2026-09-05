import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatchupsEmailSafe } from './email-layout.ts';
import { renderWeeklyRecap, type WeeklyRecap } from './recap.ts';

function recapWithWinner(winner: 'HOME' | 'AWAY'): WeeklyRecap {
  return {
    season: 2026,
    week: 3,
    games: [{
      espn_matchup_id: 12,
      away_name: 'Taco MacArthur',
      away_points: '103.3',
      home_name: 'The Penguins',
      home_points: '137.9',
      winner,
      detail: null,
    }],
    awards: [],
    bench: [],
    standings: [],
    predictions: [],
    power: [],
    nextWeek: [],
    luck: [],
    allPlay: [],
    streaks: [],
    grudge: null,
    history: [],
    recordWatch: [],
    disputed: null,
  };
}

test('email matchup scores put the winner first with reliable score spacing', () => {
  const recap = recapWithWinner('HOME');
  const out = makeMatchupsEmailSafe(
    renderWeeklyRecap(recap, 'https://grudge.planitnow.us'),
    recap
  );

  const winnerAt = out.html.indexOf('The Penguins');
  const loserAt = out.html.indexOf('Taco MacArthur');
  assert.ok(winnerAt >= 0 && loserAt >= 0 && winnerAt < loserAt, 'winner should render first');
  assert.match(out.html, /<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"/);
  assert.match(out.html, /padding:2px 0 2px 16px;text-align:right;white-space:nowrap;font-weight:700">137\.9/);
  assert.doesNotMatch(out.html, /▸/);
  assert.match(out.text, /The Penguins 137\.9\nTaco MacArthur 103\.3/);
  assert.doesNotMatch(out.text, /Taco MacArthur 103\.3 at The Penguins 137\.9/);
});

test('away winners also render first', () => {
  const recap = recapWithWinner('AWAY');
  const out = makeMatchupsEmailSafe(
    renderWeeklyRecap(recap, 'https://grudge.planitnow.us'),
    recap
  );

  assert.ok(out.html.indexOf('Taco MacArthur') < out.html.indexOf('The Penguins'));
  assert.match(out.text, /Taco MacArthur 103\.3\nThe Penguins 137\.9/);
});
