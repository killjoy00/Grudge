import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatRecapPlainText } from './recap-text.ts';

test('plain-text recap has a masthead, section rules, and visible section spacing', () => {
  const source = [
    'UNC Grudge Match — 2026 Week 3',
    'Rosters were set, lineups were regretted.',
    '',
    "THIS WEEK'S GAMES",
    'Run & Hide 101.2 at The Penguins 111.7',
    '  Surprise: Josh Allen (The Penguins) — projected 20.9, scored 36.3 (+15.4)',
    '  Worst call: Run & Hide benched Jerry Jeudy (16.1)',
    '',
    'Another Team 120.0 at Rival 119.8',
    '',
    'STANDINGS',
    '1. The Penguins — 3-0, 340.1 points',
    '',
    'Full site: https://grudge.planitnow.us',
  ].join('\n');

  const text = formatRecapPlainText(source);

  assert.match(text, /^UNC GRUDGE MATCH\n2026 SEASON · WEEK 3\n====================\n/);
  assert.match(text, /\n\n\nTHIS WEEK'S GAMES\n--------------------\n/);
  assert.match(text, /\n  - Surprise: Josh Allen/);
  assert.match(text, /\n  - Worst call: Run & Hide/);
  // A blank line between games remains a single blank line; top-level sections
  // get two, so a plain-text client has a real visual hierarchy.
  assert.match(text, /111\.7[\s\S]*\n\nAnother Team 120\.0/);
  assert.match(text, /Rival 119\.8\n\n\nSTANDINGS\n--------------------\n/);
  assert.match(text, /\n\n\nFULL SITE\n--------------------\nhttps:\/\/grudge\.planitnow\.us$/);
  assert.doesNotMatch(text, /\n{4,}/);
});

test('pickup sections and coming-up section receive the same formatting', () => {
  const source = [
    'UNC Grudge Match — 2026 Week 7',
    'Another week down.',
    '',
    'WAIVER PICKUPS',
    'Player One (WR) — Team A; $12.00 FAAB',
    '',
    '10+ POINT PICKUPS',
    'Player Two (RB) — Team B via free agency',
    '',
    'COMING UP — WEEK 8',
    'Picks lock Saturday at midnight ET.',
    'Team A at Team B',
  ].join('\r\n');

  const text = formatRecapPlainText(source);

  assert.match(text, /WAIVER PICKUPS\n--------------------/);
  assert.match(text, /10\+ POINT PICKUPS\n--------------------/);
  assert.match(text, /COMING UP — WEEK 8\n--------------------/);
  assert.doesNotMatch(text, /\r/);
});
