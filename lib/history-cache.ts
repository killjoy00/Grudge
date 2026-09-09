import 'server-only';

import { unstable_cache } from 'next/cache';
import { getSeasonStandings } from './queries.ts';
import {
  getAllSeasonRecords,
  getFranchiseManagersByKey,
  getFranchiseSeasonsByKey,
  getManagerProfile,
  getManagerSeasonsByKey,
  getRichChampions,
  getSeasonManagers,
  getSeasonPlayoffGames,
} from './history-queries.ts';
import {
  getFranchiseIdentity,
  getFranchiseKeyForEspnId,
  getFranchiseKeyPlayersByKey,
} from './history-identity-queries.ts';
import { getTrackedGameRecords, getTrackedSeasonHighlights } from './tracked-game-queries.ts';

export const getCachedFranchiseByKey = unstable_cache(
  async (franchiseKey: string) => Promise.all([
    getFranchiseIdentity(franchiseKey),
    getFranchiseSeasonsByKey(franchiseKey),
    getFranchiseManagersByKey(franchiseKey),
    getFranchiseKeyPlayersByKey(franchiseKey),
  ]),
  ['history-franchise-by-key-v2'],
  { revalidate: 86400 }
);

export const getCachedFranchiseKeyForEspnId = unstable_cache(
  getFranchiseKeyForEspnId,
  ['history-franchise-key-for-espn-id-v2'],
  { revalidate: 86400 }
);

export const getCachedManagerFile = unstable_cache(
  async (managerKey: string) => Promise.all([
    getManagerProfile(managerKey),
    getManagerSeasonsByKey(managerKey),
  ]),
  ['history-manager-file'],
  { revalidate: 86400 }
);

export const getCachedHistorySeason = unstable_cache(
  async (season: number) => Promise.all([
    getSeasonStandings(season),
    getSeasonManagers(season),
    getSeasonPlayoffGames(season),
    getTrackedSeasonHighlights(season),
  ]),
  ['history-season-file-v2'],
  { revalidate: 86400 }
);

export const getCachedRichChampions = unstable_cache(
  getRichChampions,
  ['history-rich-champions'],
  { revalidate: 86400 }
);

export const getCachedHistoryRecords = unstable_cache(
  async () => Promise.all([getAllSeasonRecords(), getTrackedGameRecords()]),
  ['history-record-book-v3'],
  { revalidate: 86400 }
);
