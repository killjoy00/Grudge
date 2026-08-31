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
  getLuck,
  getPlayedSeasons,
  getPlayoffOdds,
  getPowerRankings,
  getStandings,
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
  async () => Promise.all([getAllTime(), getPlayedSeasons()]),
  ['all-time-history'],
  { revalidate: 86400 }
);
