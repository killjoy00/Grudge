import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addPickupReport, loadRecapPickups, type RecapPickup } from './pickup-recap.ts';

const rendered = {
  subject: 'Week 3 recap',
  html: '<html><body><div>recap</div><p style="margin:32px 0 8px;text-align:center"><a href="https://example.com">Open</a></p></body></html>',
  text: 'WEEK 3\n\nFull site: https://example.com',
};

const pickups: RecapPickup[] = [
  {
    player: 'Depth Piece',
    position: 'WR',
    team_name: 'Taco MacArthur',
    points: '3.2',
    projected: '5.4',
    started: false,
    acquisition_type: 'WAIVER',
    bid_amount: '0.00',
  },
  {
    player: 'Jaylen <Wright>',
    position: 'RB',
    team_name: 'The Penguins',
    points: '17.8',
    projected: '8.4',
    started: true,
    acquisition_type: 'WAIVER',
    bid_amount: '7.00',
  },
  {
    player: 'Free Agent Hero',
    position: 'TE',
    team_name: 'Brightleaf',
    points: '14.2',
    projected: null,
    started: false,
    acquisition_type: 'FREEAGENT',
    bid_amount: null,
  },
  {
    player: 'Quiet Free Agent',
    position: 'QB',
    team_name: 'Panda Bear',
    points: '6.0',
    projected: null,
    started: false,
    acquisition_type: 'FREEAGENT',
    bid_amount: null,
  },
];

test('every waiver pickup is listed with FAAB, even when it scores under ten', () => {
  const out = addPickupReport(rendered, pickups);

  assert.match(out.html, /All waiver pickups/);
  assert.match(out.html, /Depth Piece/);
  assert.match(out.html, /\$0\.00 FAAB/);
  assert.match(out.html, /Jaylen &lt;Wright&gt;/);
  assert.match(out.html, /\$7\.00 FAAB/);
  assert.match(out.text, /WAIVER PICKUPS/);
  assert.match(out.text, /Depth Piece \(WR\).*\$0\.00 FAAB.*3\.2 pts/);
});

test('10+ point highlights include both waiver and free-agent adds', () => {
  const out = addPickupReport(rendered, pickups);
  const impactStart = out.html.indexOf('10+ point pickups');
  assert.ok(impactStart >= 0);
  const impactHtml = out.html.slice(impactStart);

  assert.match(impactHtml, /Jaylen &lt;Wright&gt;/);
  assert.match(impactHtml, /through waivers/);
  assert.match(impactHtml, /17\.8 pts/);
  assert.match(impactHtml, /Free Agent Hero/);
  assert.match(impactHtml, /through free agency/);
  assert.match(impactHtml, /14\.2 pts/);
  assert.doesNotMatch(impactHtml, /Depth Piece/);
  assert.doesNotMatch(impactHtml, /Quiet Free Agent/);
  assert.match(out.text, /10\+ POINT PICKUPS/);
  assert.match(out.text, /Free Agent Hero \(TE\).*via free agency.*14\.2 pts/);
});

test('a waiver with no weekly roster score still appears in the activity report', () => {
  const out = addPickupReport(rendered, [{
    player: 'Short Stay',
    position: 'RB',
    team_name: 'The Penguins',
    points: null,
    projected: null,
    started: null,
    acquisition_type: 'WAIVER',
    bid_amount: '3.00',
  }]);

  assert.match(out.html, /Short Stay/);
  assert.match(out.html, /\$3\.00 FAAB/);
  assert.match(out.html, /no score recorded/);
  assert.doesNotMatch(out.html, /10\+ point pickups/);
});

test('no qualifying transaction activity leaves the rendered recap untouched', () => {
  assert.deepEqual(addPickupReport(rendered, []), rendered);
});

test('pickup query loads every successful ADD without pre-filtering on points', async () => {
  let sql = '';
  let params: unknown[] | undefined;
  await loadRecapPickups(async <T>(text: string, values?: unknown[]) => {
    sql = text;
    params = values;
    return [] as T[];
  }, 2026, 4);

  assert.match(sql, /t\.status = 'EXECUTED'/);
  assert.match(sql, /item ->> 'type' = 'ADD'/);
  assert.match(sql, /t\.type in \('WAIVER', 'FREEAGENT'\)/);
  assert.match(sql, /left join public\.roster_entries/);
  assert.doesNotMatch(sql, /r\.applied_points > 10/);
  assert.deepEqual(params, [2026, 4]);
});
