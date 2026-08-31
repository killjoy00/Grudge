#!/usr/bin/env -S npx tsx

/**
 * Regenerates data/manual-history/season-results.csv from the transcribed
 * standings. Run it after correcting a transcription; never hand-edit the
 * generated file. `--check` verifies the checked-in file is current without
 * writing, which is what CI and lib/history-archive.test.ts rely on.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { buildSeasonResults, parseStandings, toSeasonResultsCsv } from '../lib/history-archive.ts';

const root = new URL('../data/manual-history/', import.meta.url);
const standingsFile = new URL('standings-2005-2017.csv', root);
const resultsFile = new URL('season-results.csv', root);

const results = buildSeasonResults(parseStandings(readFileSync(standingsFile, 'utf8')));
const csv = toSeasonResultsCsv(results);

if (process.argv.includes('--check')) {
  if (readFileSync(resultsFile, 'utf8') !== csv) {
    console.error('season-results.csv is stale. Run: npm run history:derive');
    process.exit(1);
  }
  console.log(`season-results.csv is current (${results.length} rows).`);
} else {
  writeFileSync(resultsFile, csv);
  const seasons = new Set(results.map((row) => row.season));
  console.log(`Wrote ${results.length} season results across ${seasons.size} seasons.`);
}
