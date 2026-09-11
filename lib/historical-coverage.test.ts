import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recapPage = readFileSync(new URL('../app/standings/recaps/[season]/[week]/page.tsx', import.meta.url), 'utf8');
const recapArchive = readFileSync(new URL('../components/RecapArchive.tsx', import.meta.url), 'utf8');
const draftRecords = readFileSync(new URL('./draft-records.ts', import.meta.url), 'utf8');
const draftRecordsSection = readFileSync(new URL('../components/DraftRecordsSection.tsx', import.meta.url), 'utf8');

test('historical weekly recaps are open from 2005 while lineup-only sections stay evidence-gated', () => {
  assert.match(recapPage, /season < 2005/);
  assert.doesNotMatch(recapPage, /season < 2018 \|\|/);
  assert.match(recapPage, /historical \? getHistoricalRecapExtras\(season, week\)/);
  assert.match(recapPage, /const hasBenchEvidence = bench\.some/);
  assert.match(recapPage, /\{hasBenchEvidence && \(/);
  assert.match(recapPage, /weekly player ownership, starts,/);
  assert.doesNotMatch(recapArchive, /Weekly recaps begin with the ESPN week-by-week archive in 2018/);
});

test('productive misses use and describe the validated draft corpus rather than an ESPN-era cutoff', () => {
  const start = draftRecords.indexOf('productiveMisses');
  const end = draftRecords.indexOf('asPublic<RepeatDraftRow>', start);
  assert.ok(start >= 0 && end > start);
  const query = draftRecords.slice(start, end);
  assert.match(query, /where active_weeks >= 8/);
  assert.doesNotMatch(query, /season >= 2018/);
  assert.doesNotMatch(draftRecordsSection, /available weekly-roster era/i);
  assert.match(draftRecordsSection, /across validated draft seasons/);
  assert.match(draftRecordsSection, /Validated-season misses/);
});
