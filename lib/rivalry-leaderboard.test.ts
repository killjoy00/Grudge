import assert from 'node:assert/strict';
import test from 'node:test';

import { rivalryHighlights, seriesLeader, type RivalryPairRow } from './rivalry-leaderboard.ts';

const pair = (
  a: string,
  b: string,
  games: number,
  aWins: number,
  bWins: number,
  playoffGames = 0,
  aPlayoffWins = 0,
  bPlayoffWins = 0
): RivalryPairRow => ({
  manager_a_key: a.toLowerCase(),
  manager_a_name: a,
  manager_b_key: b.toLowerCase(),
  manager_b_name: b,
  games,
  manager_a_wins: aWins,
  manager_b_wins: bWins,
  ties: games - aWins - bWins,
  playoff_games: playoffGames,
  manager_a_playoff_wins: aPlayoffWins,
  manager_b_playoff_wins: bPlayoffWins,
  first_season: 2005,
  last_season: 2025,
});

test('grudge highlights reward the intended kinds of manager history', () => {
  const most = pair('Alpha', 'Bravo', 45, 30, 15, 5, 4, 1);
  const closest = pair('Charlie', 'Delta', 36, 18, 18, 2, 1, 1);
  const domination = pair('Echo', 'Foxtrot', 38, 27, 11, 4, 3, 1);
  const playoff = pair('Golf', 'Hotel', 32, 16, 16, 10, 3, 7);
  const tiny = pair('India', 'Juliet', 3, 3, 0, 0, 0, 0);

  const highlights = rivalryHighlights([closest, playoff, tiny, domination, most]);
  assert.equal(highlights.mostPlayed, most);
  assert.equal(highlights.closest, closest);
  assert.equal(highlights.domination, domination);
  assert.equal(highlights.playoffNemesis, playoff);
});

test('a tiny undefeated grudge cannot become the domination headline', () => {
  const established = pair('Alpha', 'Bravo', 20, 14, 6);
  const tiny = pair('Charlie', 'Delta', 2, 2, 0);
  assert.equal(rivalryHighlights([tiny, established]).domination, established);
});

test('seriesLeader works for lifetime and playoff records', () => {
  const row = pair('Alpha', 'Bravo', 30, 12, 18, 8, 6, 2);
  assert.deepEqual(seriesLeader(row), { id: 'bravo', name: 'Bravo', wins: 18, losses: 12 });
  assert.deepEqual(seriesLeader(row, true), { id: 'alpha', name: 'Alpha', wins: 6, losses: 2 });
});
