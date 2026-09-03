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
  getAllTime,
  getFranchiseHistory,
  getFranchiseManagers,
  getFranchiseSeasons,
  getFranchiseKeyPlayers,
  getLuck,
  getPlayedSeasons,
  getPreseasonTeams,
  getPlayoffOdds,
  getPowerRankings,
  getSeasonChampions,
  getSeasonStandings,
  getStandings,
  getTopScoringWeeks,
  getTopPlayerWeeks,
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

/** The ten teams of a season that has not kicked off yet, at 0-0. */
export const getCachedPreseasonTeams = unstable_cache(
  getPreseasonTeams,
  ['preseason-teams'],
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
    getTopPlayerWeeks(10),
  ]),
  ['all-time-history'],
  { revalidate: 86400 }
);

/** The franchise file behind an ESPN team id: its seasons and its managers. */
export const getCachedFranchiseFile = unstable_cache(
  async (espnTeamId: number) => Promise.all([
    getFranchiseSeasons(espnTeamId),
    getFranchiseManagers(espnTeamId),
    getFranchiseKeyPlayers(espnTeamId),
  ]),
  ['franchise-file'],
  { revalidate: 86400 }
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
  ['season-trades'],
  { revalidate: 3600 }
);

export const getCachedTradeRecords = unstable_cache(
  allTimeTradeRecords,
  ['trade-records'],
  { revalidate: 3600 }
);
