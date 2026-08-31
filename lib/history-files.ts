/**
 * Where the archive lives on disk. Split from the pure derivation so the
 * derive script and its test read exactly the same bytes.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import type { EspnLeague } from './espn-archive.ts';
import type { ArchiveSources } from './history-archive.ts';

export const archiveDir = new URL('../data/manual-history/', import.meta.url);
export const espnDir = new URL('../data/history/', import.meta.url);

export const readArchiveFile = (name: string) =>
  readFileSync(new URL(name, archiveDir), 'utf8');

export function readEspnLeagues(): { season: number; league: EspnLeague }[] {
  const leagues: { season: number; league: EspnLeague }[] = [];
  for (const entry of readdirSync(espnDir).sort()) {
    if (!/^\d{4}$/.test(entry)) continue;
    const file = new URL(`${entry}/league.json.gz`, espnDir);
    if (!existsSync(file)) continue;
    const league = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as EspnLeague;
    leagues.push({ season: league.seasonId ?? Number(entry), league });
  }
  return leagues;
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
