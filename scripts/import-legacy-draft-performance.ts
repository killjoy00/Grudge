#!/usr/bin/env -S npx tsx
/** Import the committed 2008-2017 draft-performance dataset into Neon. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { connect, runTransaction, stmt, upsertChunked } from '../pipeline/db.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'derived', 'legacy-draft-performance.csv');

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows.filter((r) => r.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  );
}

const rows = parseCsv(readFileSync(FILE, 'utf8')).map((row) => ({
  season: Number(row.season),
  espn_player_id: Number(row.espn_player_id),
  fantasy_points: Number(row.fantasy_points),
  source: row.source,
  source_player_id: row.source_player_id || null,
}));

if (rows.length < 1300) throw new Error(`Legacy draft dataset unexpectedly small: ${rows.length} rows`);
for (const row of rows) {
  if (!Number.isInteger(row.season) || row.season < 2008 || row.season > 2017) {
    throw new Error(`Invalid season in legacy draft dataset: ${JSON.stringify(row)}`);
  }
  if (!Number.isFinite(row.fantasy_points)) {
    throw new Error(`Invalid fantasy points in legacy draft dataset: ${JSON.stringify(row)}`);
  }
}

const sql = connect();
await runTransaction(sql, [
  stmt('delete from public.legacy_draft_performance where season between 2008 and 2017'),
  ...upsertChunked(
    'public.legacy_draft_performance',
    ['season', 'espn_player_id', 'fantasy_points', 'source', 'source_player_id'],
    rows,
    ['season', 'espn_player_id']
  ),
]);

const bySource = new Map<string, number>();
for (const row of rows) {
  const source = String(row.source);
  bySource.set(source, (bySource.get(source) ?? 0) + 1);
}
console.log(
  `Imported ${rows.length} legacy draft player-seasons: `
  + [...bySource.entries()].map(([source, count]) => `${source}=${count}`).join(', ')
);
