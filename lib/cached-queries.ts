import 'server-only';

/**
 * Explicit caches for public league data.
 *
 * The pages using these functions render on request so a deploy never needs a
 * live database connection. These caches retain the old hourly/daily freshness
 * guarantees without coupling `next build` to Neon.
 */
import { unstable_cache } from 'next/cache';
import { allTimeTradeRecords, seasonTrades } from './trade-history-queries.ts';
import {
  getLuck,
  getPlayedSeasons,
  getPlayoffOdds,
  getSeasonStandings,
  getStandings,
} from './queries.ts';
import {
  getIdentityPowerRankings,
  getIdentitySeasonField,
  getIdentitySeasonList,
} from './season-identity-queries.ts';

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

/** A settled season's standings plus the score-derived schedule-luck index. */
export const getCachedSeasonTable = unstable_cache(
  async (season: number) => Promise.all([getSeasonStandings(season), getLuck(season)]),
  ['season-table'],
  { revalidate: 3600 }
);

/** The franchise field of a season, valid before its first result. */
export const getCachedPreseasonTeams = unstable_cache(
  getIdentitySeasonField,
  ['season-identity-field-v2'],
  { revalidate: 3600 }
);

/** Every canonical franchise season, including a current season with no results. */
export const getCachedSeasonList = unstable_cache(
  getIdentitySeasonList,
  ['season-identity-list-v2'],
  { revalidate: 3600 }
);

export const getCachedPowerRankings = unstable_cache(
  getIdentityPowerRankings,
  ['power-rankings-identity-v2'],
  { revalidate: 3600 }
);

export const getCachedPlayoffOdds = unstable_cache(
  getPlayoffOdds,
  ['playoff-odds'],
  { revalidate: 3600 }
);

/**
 * Trades, valued.
 *
 * Cached because valuing a trade replays every week of that season's rosters
 * through the lineup solver, and the all-time ledger does it for every season
 * at once. None of those numbers can move until the weekly pipeline runs, so
 * paying that cost per request would be waste rather than freshness. Votes are
 * NOT cached here -- they are read per member through asUser and change the
 * moment somebody clicks.
 */
export const getCachedSeasonTrades = unstable_cache(
  seasonTrades,
  ['season-trades-v3'],
  { revalidate: 3600 }
);

export const getCachedTradeRecords = unstable_cache(
  allTimeTradeRecords,
  ['trade-records-v3'],
  { revalidate: 3600 }
);
