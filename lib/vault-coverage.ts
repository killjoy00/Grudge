import 'server-only';

import { asPublic } from './db.ts';

export interface VaultCoverageRow {
  season: number;
  teams: number;
  decided_games: number;
  draft_picks: number;
  transactions: number;
  roster_entries: number;
  power_rows: number;
}

/**
 * What evidence is actually queryable for each season. The Vault reports
 * coverage rather than implying every ESPN view survived equally far back.
 */
export async function getVaultCoverage() {
  return asPublic<VaultCoverageRow>(
    `select s.season,
            (select count(*)::int from public.teams t where t.season = s.season) as teams,
            (select count(*)::int from public.matchups m where m.season = s.season and m.is_final) as decided_games,
            (select count(*)::int from public.draft_picks d where d.season = s.season) as draft_picks,
            (select count(*)::int from public.transactions x where x.season = s.season) as transactions,
            (select count(*)::int from public.roster_entries r where r.season = s.season) as roster_entries,
            (select count(*)::int from public.power_rankings p where p.season = s.season) as power_rows
       from public.seasons s
      where s.season >= 2005
      order by s.season desc`
  );
}
