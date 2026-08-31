#!/usr/bin/env -S npx tsx

/**
 * Builds the two files the importer loads -- `season-results.csv` and
 * `manager-seasons.csv` -- from both eras at once:
 *
 *   2005-2017  data/manual-history/standings-2005-2017.csv (+ manager-tenures.csv)
 *   2018-      data/history/<year>/league.json.gz, mapped through
 *              espn-franchises.csv and espn-managers.csv
 *
 * Run it after correcting a transcription or backfilling a new ESPN season;
 * never hand-edit the generated files. `--check` verifies they are current
 * without writing, which is what lib/history-archive.test.ts relies on.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import {
  buildLeagueHistory,
  toManagerSeasonsCsv,
  toSeasonResultsCsv,
} from '../lib/history-archive.ts';
import { archiveDir, readArchiveSources } from '../lib/history-files.ts';

const history = buildLeagueHistory(readArchiveSources());

const files: [URL, string][] = [
  [new URL('season-results.csv', archiveDir), toSeasonResultsCsv(history.seasons)],
  [new URL('manager-seasons.csv', archiveDir), toManagerSeasonsCsv(history.managerSeasons)],
];

if (process.argv.includes('--check')) {
  const stale = files.filter(([file, csv]) => readFileSync(file, 'utf8') !== csv);
  if (stale.length) {
    for (const [file] of stale) console.error(`stale: ${file.pathname.split('/').pop()}`);
    console.error('Run: npm run history:derive');
    process.exit(1);
  }
  console.log(`Generated files are current (${history.seasons.length} season results).`);
} else {
  for (const [file, csv] of files) writeFileSync(file, csv);
  const years = new Set(history.seasons.map((row) => row.season));
  console.log(
    `Wrote ${history.seasons.length} season results and ${history.managerSeasons.length} ` +
    `manager assignments across ${years.size} seasons ` +
    `(${Math.min(...years)}-${Math.max(...years)}).` +
    (history.skipped.length ? ` Skipped unplayed: ${history.skipped.join(', ')}.` : '')
  );
}
