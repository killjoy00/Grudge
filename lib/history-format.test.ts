import assert from 'node:assert/strict';
import test from 'node:test';

import {
  finish,
  franchiseHref,
  managerHref,
  ordinal,
  pointsPerGame,
  record,
  seasonHref,
  winRate,
} from './history-format.ts';

test('records and win percentages handle ties', () => {
  assert.equal(record(8, 5, 1), '8-5-1');
  assert.equal(record(8, 6), '8-6');
  assert.equal(winRate(8, 5, 1), (8 + 0.5) / 14);
});

test('points per game normalizes seasons with different schedule lengths', () => {
  assert.equal(pointsPerGame('1200', 8, 4), 100);
  assert.equal(pointsPerGame('1300', 8, 5), 100);
  assert.equal(pointsPerGame('1400', 9, 5), 100);
  assert.equal(pointsPerGame(null, 9, 5), null);
  assert.equal(pointsPerGame('0', 0, 0), null);
});

test('finish labels use correct ordinals', () => {
  assert.equal(finish(1), 'Champion');
  assert.equal(finish(2), 'Runner-up');
  assert.equal(finish(3), 'Lost semifinal');
  assert.equal(finish(6), 'Lost first round');
  assert.equal(finish(7), '7th');
  assert.equal(finish(11), '11th');
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(22), '22nd');
  assert.equal(ordinal(23), '23rd');
});

test('history href helpers make permanent archive routes', () => {
  assert.equal(franchiseHref('brightleaf-yuppies'), '/franchise/brightleaf-yuppies');
  assert.equal(managerHref('jonathan-crisp'), '/manager/jonathan-crisp');
  assert.equal(seasonHref(2005), '/history/2005');
  assert.equal(franchiseHref('a b'), '/franchise/a%20b');
});
