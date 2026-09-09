import 'server-only';

import { asPublic } from './db.ts';

/** Shared shape for tracked matchup record queries. Identity is already resolved. */
export interface MatchupRecordRow {
  season: number;
  week: number;
  espn_team_id: number;
  franchise_key: string;
  team_name: string;
  opponent_name: string;
  points_for: string;
  points_against: string;
  result: 'W' | 'L' | 'T';
  margin: string;
  playoff_tier: string | null;
}

/** Shared shape for tracked player-week record queries. */
export interface PlayerWeekRecordRow {
  season: number;
  week: number;
  espn_player_id: number;
  full_name: string | null;
  default_position_id: number | null;
  points: string;
  franchise_key: string;
  team_name: string;
  is_starter: boolean;
  playoff_tier: string | null;
}

/** Settled franchise-season results. Current-season identity lives elsewhere. */
export interface FranchiseSeasonRow {
  season: number;
  team_name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: string | null;
  points_against: string | null;
  playoff_wins: number;
  playoff_losses: number;
  final_place: number | null;
  is_champion: boolean;
  is_runner_up: boolean;
  manager_key: string | null;
  manager: string | null;
  source: string;
}

export interface FranchiseManagerRow {
  manager_key: string;
  display_name: string;
  seasons: number;
  regular_wins: number;
  regular_losses: number;
  regular_ties: number;
  playoff_wins: number;
  playoff_losses: number;
  championships: number;
  top_four: number;
  playoff_appearances: number;
  regular_points_for: string | null;
  first_season: number;
  last_season: number;
}

export async function getFranchiseSeasonsByKey(franchiseKey: string) {
  return asPublic<FranchiseSeasonRow>(
    `select fs.season, fs.team_name,
            fs.regular_wins as wins, fs.regular_losses as losses, fs.regular_ties as ties,
            round(fs.regular_points_for, 1)::text as points_for,
            round(fs.regular_points_against, 1)::text as points_against,
            fs.playoff_wins, fs.playoff_losses, fs.final_place,
            fs.is_champion, fs.is_runner_up,
            m.manager_key, m.display_name as manager, fs.source
       from public.franchise_seasons fs
       left join public.manager_franchise_seasons ms
         on ms.season = fs.season and ms.franchise_key = fs.franchise_key and ms.is_primary
       left join public.managers m using (manager_key)
      where fs.franchise_key = $1
      order by fs.season desc`,
    [franchiseKey]
  );
}

export async function getFranchiseManagersByKey(franchiseKey: string) {
  return asPublic<FranchiseManagerRow>(
    `select manager_key, display_name, seasons, regular_wins, regular_losses,
            regular_ties, playoff_wins, playoff_losses, championships, top_four,
            playoff_appearances, round(regular_points_for, 1)::text as regular_points_for,
            first_season, last_season
       from public.franchise_manager_totals
      where franchise_key = $1
      order by last_season desc, first_season desc`,
    [franchiseKey]
  );
}

export interface ManagerProfileRow {
  manager_key: string;
  display_name: string;
  seasons: number;
  regular_wins: number;
  regular_losses: number;
  regular_ties: number;
  playoff_wins: number;
  playoff_losses: number;
  championships: number;
  runner_ups: number;
  top_four: number;
  playoff_appearances: number;
  title_seasons: string | null;
  regular_points_for: string | null;
  first_season: number;
  last_season: number;
}

export interface ManagerSeasonRow {
  season: number;
  franchise_key: string;
  current_name: string;
  team_name: string;
  espn_team_id: number | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: string | null;
  playoff_wins: number;
  playoff_losses: number;
  final_place: number | null;
  is_champion: boolean;
  is_runner_up: boolean;
}

export async function getManagerProfile(managerKey: string) {
  const rows = await asPublic<ManagerProfileRow>(
    `select manager_key, display_name, seasons, regular_wins, regular_losses,
            regular_ties, playoff_wins, playoff_losses, championships,
            runner_ups, top_four, playoff_appearances, title_seasons,
            round(regular_points_for, 1)::text as regular_points_for,
            first_season, last_season
       from public.manager_history_totals
      where manager_key = $1`,
    [managerKey]
  );
  return rows[0] ?? null;
}

/** Completed season rows for a manager's career statistics. */
export async function getManagerSeasonsByKey(managerKey: string) {
  return asPublic<ManagerSeasonRow>(
    `select fs.season, fs.franchise_key, f.current_name, fs.team_name, fs.espn_team_id,
            fs.regular_wins as wins, fs.regular_losses as losses, fs.regular_ties as ties,
            round(fs.regular_points_for, 1)::text as points_for,
            fs.playoff_wins, fs.playoff_losses, fs.final_place,
            fs.is_champion, fs.is_runner_up
       from public.manager_franchise_seasons ms
       join public.franchise_seasons fs
         on fs.season = ms.season and fs.franchise_key = ms.franchise_key
       join public.franchises f using (franchise_key)
      where ms.manager_key = $1 and ms.is_primary
      order by fs.season desc`,
    [managerKey]
  );
}

export interface SeasonManagerRow {
  franchise_key: string;
  manager_key: string;
  display_name: string;
}

/** Manager attribution is identity data and is valid before results exist. */
export async function getSeasonManagers(season: number) {
  return asPublic<SeasonManagerRow>(
    `select ms.franchise_key, m.manager_key, m.display_name
       from public.manager_franchise_seasons ms
       join public.managers m using (manager_key)
      where ms.season = $1 and ms.is_primary
      order by m.display_name`,
    [season]
  );
}

export interface RichChampionRow {
  season: number;
  champion_key: string;
  champion_name: string;
  champion_team_name: string;
  champion_manager_key: string | null;
  champion_manager: string | null;
  champion_wins: number;
  champion_losses: number;
  champion_ties: number;
  champion_points_for: string | null;
  runner_up_key: string | null;
  runner_up_name: string | null;
  runner_up_team_name: string | null;
  runner_up_manager_key: string | null;
  runner_up_manager: string | null;
  champion_score: string | null;
  runner_up_score: string | null;
  source: string;
}

export async function getRichChampions() {
  return asPublic<RichChampionRow>(
    `select ch.season, ch.franchise_key as champion_key,
            cf.current_name as champion_name, ch.team_name as champion_team_name,
            cm.manager_key as champion_manager_key, cman.display_name as champion_manager,
            ch.regular_wins as champion_wins, ch.regular_losses as champion_losses,
            ch.regular_ties as champion_ties,
            round(ch.regular_points_for, 1)::text as champion_points_for,
            ru.franchise_key as runner_up_key, rf.current_name as runner_up_name,
            ru.team_name as runner_up_team_name,
            rm.manager_key as runner_up_manager_key, rman.display_name as runner_up_manager,
            final.champion_score, final.runner_up_score, ch.source
       from public.franchise_seasons ch
       join public.franchises cf on cf.franchise_key = ch.franchise_key
       left join public.manager_franchise_seasons cm
         on cm.season = ch.season and cm.franchise_key = ch.franchise_key and cm.is_primary
       left join public.managers cman on cman.manager_key = cm.manager_key
       left join public.franchise_seasons ru on ru.season = ch.season and ru.is_runner_up
       left join public.franchises rf on rf.franchise_key = ru.franchise_key
       left join public.manager_franchise_seasons rm
         on rm.season = ru.season and rm.franchise_key = ru.franchise_key and rm.is_primary
       left join public.managers rman on rman.manager_key = rm.manager_key
       left join lateral (
         select case when m.home_team_id = ch.espn_team_id
                       then round(m.home_points, 1)::text else round(m.away_points, 1)::text end as champion_score,
                case when m.home_team_id = ch.espn_team_id
                       then round(m.away_points, 1)::text else round(m.home_points, 1)::text end as runner_up_score
           from public.matchups m
          where ch.espn_team_id is not null and ru.espn_team_id is not null
            and m.season = ch.season and m.is_final and m.playoff_tier = 'WINNERS_BRACKET'
            and ((m.home_team_id = ch.espn_team_id and m.away_team_id = ru.espn_team_id)
              or (m.away_team_id = ch.espn_team_id and m.home_team_id = ru.espn_team_id))
          order by m.week desc
          limit 1
       ) final on true
      where ch.is_champion
      order by ch.season desc`
  );
}

export interface AllSeasonRecordRow {
  season: number;
  franchise_key: string;
  current_name: string;
  team_name: string;
  manager_key: string | null;
  manager: string | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: string | null;
  points_against: string | null;
  playoff_wins: number;
  playoff_losses: number;
  final_place: number | null;
  is_champion: boolean;
  is_runner_up: boolean;
}

/** Historical record books intentionally consume settled result rows only. */
export async function getAllSeasonRecords() {
  return asPublic<AllSeasonRecordRow>(
    `select fs.season, fs.franchise_key, f.current_name, fs.team_name,
            m.manager_key, m.display_name as manager,
            fs.regular_wins as wins, fs.regular_losses as losses, fs.regular_ties as ties,
            round(fs.regular_points_for, 1)::text as points_for,
            round(fs.regular_points_against, 1)::text as points_against,
            fs.playoff_wins, fs.playoff_losses, fs.final_place,
            fs.is_champion, fs.is_runner_up
       from public.franchise_seasons fs
       join public.franchises f using (franchise_key)
       left join public.manager_franchise_seasons ms
         on ms.season = fs.season and ms.franchise_key = fs.franchise_key and ms.is_primary
       left join public.managers m using (manager_key)
      order by fs.season desc, fs.regular_wins desc, fs.regular_points_for desc`
  );
}
