/**
 * Where the archive lives on disk. Split from the pure derivation so the
 * derive script and its test read exactly the same bytes.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import type { EspnLeague } from './espn-archive.ts';
import type { ArchiveSources } from './history-archive.ts';

export const archiveDir = new URL('../data/manual-history/', import.meta.url);

/**
 * BOTH ESPN archive directories, and both are permanent.
 *
 * data/history/ is the one-off 2018-2025 backfill. data/seasons/ is where the
 * weekly pipeline writes, so it is where every season from 2026 on lives and
 * where the season currently being played is right now.
 *
 * This used to read data/history/ alone, which meant the archive could not see
 * a season the pipeline had captured -- so a season that finished would never
 * reach the record books at all, no matter how often anything was re-run. The
 * bug was invisible because no season had finished under the new layout yet.
 *
 * Later directories win on a collision, but there should not be one: a season
 * is captured by exactly one of the two.
 */
export const espnDirs = [
  new URL('../data/history/', import.meta.url),
  new URL('../data/seasons/', import.meta.url),
];

/** @deprecated Kept for callers that only ever wanted the backfill directory. */
export const espnDir = espnDirs[0]!;

export const readArchiveFile = (name: string) =>
  readFileSync(new URL(name, archiveDir), 'utf8');

export function readEspnLeagues(): { season: number; league: EspnLeague }[] {
  const bySeason = new Map<number, EspnLeague>();
  for (const dir of espnDirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir).sort()) {
      if (!/^\d{4}$/.test(entry)) continue;
      const file = new URL(`${entry}/league.json.gz`, dir);
      if (!existsSync(file)) continue;
      const league = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as EspnLeague;
      bySeason.set(league.seasonId ?? Number(entry), league);
    }
  }
  return [...bySeason].sort(([a], [b]) => a - b).map(([season, league]) => ({ season, league }));
}

export function readArchiveSources(): ArchiveSources {
  return {
    standings: readArchiveFile('standings-2005-2017.csv'),
    tenures: readArchiveFile('manager-tenures.csv'),
    franchiseIdMap: readArchiveFile('espn-franchises.csv'),
    espnManagerMap: readArchiveFile('espn-managers.csv'),
    espnLeagues: readEspnLeagues(),
  };
}
