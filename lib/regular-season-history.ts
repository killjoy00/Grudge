import 'server-only';

import { unstable_cache } from 'next/cache';
import { asPublic } from './db.ts';

export interface RegularSeasonChampionRow {
  season: number;
  franchise_key: string;
  current_name: string;
  team_name: string;
  manager_key: string | null;
  manager_name: string | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: string | null;
}

/**
 * One regular-season champion per completed season.
 *
 * This intentionally uses the exact ordering the standings page already uses:
 * win percentage first, then total points scored. Keeping the rule in SQL lets
 * archive seasons and ESPN seasons resolve through the same path without
 * depending on weekly data that does not exist before 2018.
 */
async function getRegularSeasonChampions() {
  return asPublic<RegularSeasonChampionRow>(
    `with ranked as (
       select fs.*,
              row_number() over (
                partition by fs.season
                order by (fs.regular_wins + fs.regular_ties / 2.0)
                         / nullif(fs.regular_wins + fs.regular_losses + fs.regular_ties, 0) desc,
                         fs.regular_points_for desc,
                         fs.franchise_key
              ) as regular_rank
         from public.franchise_seasons fs
     )
     select r.season, r.franchise_key, f.current_name, r.team_name,
            m.manager_key, m.display_name as manager_name,
            r.regular_wins as wins, r.regular_losses as losses, r.regular_ties as ties,
            round(r.regular_points_for, 1)::text as points_for
       from ranked r
       join public.franchises f using (franchise_key)
       left join public.manager_franchise_seasons ms
         on ms.season = r.season and ms.franchise_key = r.franchise_key and ms.is_primary
       left join public.managers m using (manager_key)
      where r.regular_rank = 1
      order by r.season desc`
  );
}

export const getCachedRegularSeasonChampions = unstable_cache(
  getRegularSeasonChampions,
  ['regular-season-champions-v2'],
  { revalidate: 86400 }
);
