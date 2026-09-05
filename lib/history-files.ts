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
 * data/history/ now contains authenticated raw evidence back to 2005, including
 * the recovered legacy scoreboards/drafts plus the one-off 2018-2025 backfill.
 * data/seasons/ is where the weekly pipeline writes 2026 onward.
 *
 * readEspnLeagues() deliberately returns the whole raw archive because callers
 * such as The Vault may want it. readArchiveSources(), however, feeds the
 * canonical franchise-season derivation: 2005-2017 final standings and titles
 * remain commissioner-authoritative, so that function passes only 2018+ ESPN
 * seasons and avoids treating the recovered evidence as a competing source.
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
    // Recovered 2005-2017 ESPN data enriches games/drafts, but the commissioner
    // ledger still owns those seasons' final standings/championship record.
    espnLeagues: readEspnLeagues().filter(({ season }) => season >= 2018),
  };
}
