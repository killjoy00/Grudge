import 'server-only';

import { asPublic } from './db.ts';

export interface FranchiseIdentity {
  franchise_key: string;
  current_name: string;
  espn_team_id: number | null;
}

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

export interface FranchiseKeyPlayerRow {
  season: number;
  full_name: string;
  position_id: number | null;
  points: string;
  starts: number;
}

export async function getFranchiseIdentity(franchiseKey: string) {
  const rows = await asPublic<FranchiseIdentity>(
    `select f.franchise_key, f.current_name,
            max(fs.espn_team_id) filter (where fs.espn_team_id is not null) as espn_team_id
       from public.franchises f
       left join public.franchise_seasons fs using (franchise_key)
      where f.franchise_key = $1
      group by f.franchise_key, f.current_name`,
    [franchiseKey]
  );
  return rows[0] ?? null;
}

export async function getFranchiseKeyForEspnId(espnTeamId: number) {
  const rows = await asPublic<{ franchise_key: string }>(
    `select franchise_key
       from public.franchise_seasons
      where espn_team_id = $1
      order by season desc
      limit 1`,
    [espnTeamId]
  );
  return rows[0]?.franchise_key ?? null;
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

export async function getFranchiseKeyPlayersByKey(franchiseKey: string) {
  return asPublic<FranchiseKeyPlayerRow>(
    `with target as (
       select max(espn_team_id) as espn_team_id
         from public.franchise_seasons
        where franchise_key = $1 and espn_team_id is not null
     )
     select season, full_name, position_id, points, starts from (
       select r.season, p.full_name, p.default_position_id as position_id,
              round(sum(r.applied_points), 1)::text as points,
              count(*)::int as starts,
              row_number() over (
                partition by r.season order by sum(r.applied_points) desc
              ) as rn
         from public.roster_entries r
         join public.players p using (espn_player_id)
         join target t on t.espn_team_id = r.espn_team_id
        where r.is_starter and r.applied_points is not null
        group by r.season, p.full_name, p.default_position_id
     ) ranked
      where rn <= 3
      order by season desc, rn`,
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

export interface PlayoffGameRow {
  season: number;
  week: number;
  espn_matchup_id: number;
  home_team_id: number;
  home_key: string;
  home_name: string;
  home_points: string;
  away_team_id: number;
  away_key: string;
  away_name: string;
  away_points: string;
  winner: string;
}

export async function getSeasonPlayoffGames(season: number) {
  return asPublic<PlayoffGameRow>(
    `select m.season, m.week, m.espn_matchup_id,
            m.home_team_id, hf.franchise_key as home_key, hf.team_name as home_name,
            round(m.home_points, 1)::text as home_points,
            m.away_team_id, af.franchise_key as away_key, af.team_name as away_name,
            round(m.away_points, 1)::text as away_points,
            m.winner
       from public.matchups m
       join public.franchise_seasons hf
         on hf.season = m.season and hf.espn_team_id = m.home_team_id
       join public.franchise_seasons af
         on af.season = m.season and af.espn_team_id = m.away_team_id
      where m.season = $1 and m.is_final
        and m.playoff_tier = 'WINNERS_BRACKET'
        and m.home_points is not null and m.away_points is not null
      order by m.week, m.espn_matchup_id`,
    [season]
  );
}

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

async function getMatchupRecord(
  season: number | null,
  kind: 'highest_score' | 'lowest_score' | 'highest_scoring_loss' | 'biggest_blowout' | 'closest_finish'
) {
  const filter = kind === 'highest_scoring_loss'
    ? `and x.result = 'L'`
    : kind === 'biggest_blowout'
      ? `and x.result = 'W'`
      : '';
  const order = kind === 'highest_score' || kind === 'highest_scoring_loss'
    ? 'x.points_for desc'
    : kind === 'lowest_score'
      ? 'x.points_for asc'
      : kind === 'biggest_blowout'
        ? 'abs(x.points_for - x.points_against) desc'
        : 'abs(x.points_for - x.points_against) asc, x.points_for desc';

  const rows = await asPublic<MatchupRecordRow>(
    `with sides as (
       select m.season, m.week, m.playoff_tier,
              m.home_team_id as espn_team_id, m.away_team_id as opponent_team_id,
              m.home_points as points_for, m.away_points as points_against,
              case m.winner when 'HOME' then 'W' when 'AWAY' then 'L' else 'T' end as result
         from public.matchups m
        where m.is_final and m.home_points is not null and m.away_points is not null
       union all
       select m.season, m.week, m.playoff_tier,
              m.away_team_id, m.home_team_id,
              m.away_points, m.home_points,
              case m.winner when 'AWAY' then 'W' when 'HOME' then 'L' else 'T' end
         from public.matchups m
        where m.is_final and m.home_points is not null and m.away_points is not null
     )
     select x.season, x.week, x.espn_team_id, fs.franchise_key,
            fs.team_name, ofs.team_name as opponent_name,
            round(x.points_for, 1)::text as points_for,
            round(x.points_against, 1)::text as points_against,
            x.result,
            round(x.points_for - x.points_against, 1)::text as margin,
            nullif(x.playoff_tier, 'NONE') as playoff_tier
       from sides x
       join public.franchise_seasons fs
         on fs.season = x.season and fs.espn_team_id = x.espn_team_id
       join public.franchise_seasons ofs
         on ofs.season = x.season and ofs.espn_team_id = x.opponent_team_id
      where ($1::int is null or x.season = $1) ${filter}
      order by ${order}
      limit 1`,
    [season]
  );
  return rows[0] ?? null;
}

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

export async function getTopPlayerWeekForSeason(season: number) {
  const rows = await asPublic<PlayerWeekRecordRow>(
    `select r.season, r.week, r.espn_player_id, p.full_name, p.default_position_id,
            round(r.applied_points, 1)::text as points,
            fs.franchise_key, fs.team_name, r.is_starter,
            nullif(m.playoff_tier, 'NONE') as playoff_tier
       from public.roster_entries r
       join public.players p using (espn_player_id)
       join public.franchise_seasons fs
         on fs.season = r.season and fs.espn_team_id = r.espn_team_id
       join public.weeks w
         on w.season = r.season and w.week = r.week and w.results_complete
       left join public.matchups m
         on m.season = r.season and m.week = r.week
        and r.espn_team_id in (m.home_team_id, m.away_team_id)
      where r.season = $1 and r.applied_points is not null
      order by r.applied_points desc
      limit 1`,
    [season]
  );
  return rows[0] ?? null;
}

export async function getSeasonHighlights(season: number) {
  const [highestScore, biggestBlowout, closestFinish, topPlayer] = await Promise.all([
    getMatchupRecord(season, 'highest_score'),
    getMatchupRecord(season, 'biggest_blowout'),
    getMatchupRecord(season, 'closest_finish'),
    getTopPlayerWeekForSeason(season),
  ]);
  return { highestScore, biggestBlowout, closestFinish, topPlayer };
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

export async function getGameRecords() {
  const [highestScore, lowestScore, highestScoringLoss, biggestBlowout, closestFinish] = await Promise.all([
    getMatchupRecord(null, 'highest_score'),
    getMatchupRecord(null, 'lowest_score'),
    getMatchupRecord(null, 'highest_scoring_loss'),
    getMatchupRecord(null, 'biggest_blowout'),
    getMatchupRecord(null, 'closest_finish'),
  ]);
  return { highestScore, lowestScore, highestScoringLoss, biggestBlowout, closestFinish };
}
