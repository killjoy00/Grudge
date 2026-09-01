import 'server-only';

/**
 * Explicit caches for public league data.
 *
 * The pages using these functions render on request so a deploy never needs a
 * live database connection. These caches retain the old hourly/daily freshness
 * guarantees without coupling `next build` to Neon.
 */
import { unstable_cache } from 'next/cache';
import {
  getAllTime,
  getFranchiseHistory,
  getFranchiseManagers,
  getFranchiseSeasons,
  getLuck,
  getPlayedSeasons,
  getPlayoffOdds,
  getPowerRankings,
  getSeasonChampions,
  getSeasonStandings,
  getStandings,
  getTopScoringWeeks,
  getManagerHistory,
} from './queries.ts';

export const getCachedPlayedSeasons = unstable_cache(
  getPlayedSeasons,
  ['played-seasons'],
  { revalidate: 3600 }
);

export const getCachedStandings = unstable_cache(
  async (season: number) => Promise.all([getStandings(season), getLuck(season)]),
  ['standings'],
  { revalidate: 3600 }
);

/**
 * A season's table from the franchise record, plus the luck index where the
 * weekly feed exists. Archive seasons simply have no luck rows.
 */
export const getCachedSeasonTable = unstable_cache(
  async (season: number) => Promise.all([getSeasonStandings(season), getLuck(season)]),
  ['season-table'],
  { revalidate: 3600 }
);

/** Every season on record, newest first -- the archive era included. */
export const getCachedSeasonList = unstable_cache(
  getSeasonChampions,
  ['season-list'],
  { revalidate: 86400 }
);

export const getCachedPowerRankings = unstable_cache(
  getPowerRankings,
  ['power-rankings'],
  { revalidate: 3600 }
);

export const getCachedPlayoffOdds = unstable_cache(
  getPlayoffOdds,
  ['playoff-odds'],
  { revalidate: 3600 }
);

export const getCachedHistory = unstable_cache(
  async () => Promise.all([
    getAllTime(),
    getPlayedSeasons(),
    getFranchiseHistory(),
    getManagerHistory(),
    getSeasonChampions(),
    getTopScoringWeeks(10),
  ]),
  ['all-time-history'],
  { revalidate: 86400 }
);

/** The franchise file behind an ESPN team id: its seasons and its managers. */
export const getCachedFranchiseFile = unstable_cache(
  async (espnTeamId: number) => Promise.all([
    getFranchiseSeasons(espnTeamId),
    getFranchiseManagers(espnTeamId),
  ]),
  ['franchise-file'],
  { revalidate: 86400 }
);
