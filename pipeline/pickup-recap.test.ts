import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addPickupHighlights, loadNotablePickups } from './pickup-recap.ts';

const rendered = {
  subject: 'Week 3 recap',
  html: '<html><body><div>recap</div><p style="margin:32px 0 8px;text-align:center"><a href="https://example.com">Open</a></p></body></html>',
  text: 'WEEK 3\n\nFull site: https://example.com',
};

test('productive pickups are highlighted in HTML and text', () => {
  const out = addPickupHighlights(rendered, [{
    player: 'Jaylen <Wright>',
    position: 'RB',
    team_name: 'The Penguins',
    points: '17.8',
    projected: '8.4',
    started: true,
    acquisition_type: 'WAIVER',
    bid_amount: '7.00',
  }]);

  assert.match(out.html, /Pickups that paid off/);
  assert.match(out.html, /Jaylen &lt;Wright&gt;/);
  assert.match(out.html, /17\.8 pts/);
  assert.match(out.html, /8\.4 projected/);
  assert.match(out.html, /\$7\.00 FAAB/);
  assert.match(out.text, /NOTABLE PICKUPS/);
  assert.match(out.text, /Jaylen <Wright> \(RB\)/);
  assert.match(out.text, /17\.8 pts · 8\.4 projected · started · \$7\.00 FAAB/);
});

test('no qualifying pickups leaves the rendered recap untouched', () => {
  assert.deepEqual(addPickupHighlights(rendered, []), rendered);
});

test('pickup query requires a successful ADD and strictly more than ten points', async () => {
  let sql = '';
  let params: unknown[] | undefined;
  await loadNotablePickups(async <T>(text: string, values?: unknown[]) => {
    sql = text;
    params = values;
    return [] as T[];
  }, 2026, 4);

  assert.match(sql, /t\.status = 'EXECUTED'/);
  assert.match(sql, /item ->> 'type' = 'ADD'/);
  assert.match(sql, /t\.type in \('WAIVER', 'FREEAGENT'\)/);
  assert.match(sql, /r\.applied_points > 10/);
  assert.deepEqual(params, [2026, 4]);
});
