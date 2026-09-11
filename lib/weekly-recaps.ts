import 'server-only';

import { unstable_cache } from 'next/cache';
import { asPublic } from './db.ts';

export interface RecapWeek {
  week: number;
}

/**
 * Regular-season weeks with a settled recap available for a season.
 *
 * team_week_results is deliberately regular-season-only, which is exactly the
 * boundary the weekly recap uses. Recovered 2005-2017 scoreboards now populate
 * this table too, so those seasons can render team-level historical recaps while
 * lineup-dependent sections remain gated by their own evidence.
 */
async function recapWeeks(season: number) {
  return asPublic<RecapWeek>(
    `select distinct week::int as week
       from public.team_week_results
      where season = $1 and points_for is not null
      order by week desc`,
    [season]
  );
}

export const getRecapWeeks = unstable_cache(
  recapWeeks,
  ['weekly-recap-weeks-2026.2'],
  { revalidate: 3600 }
);
