import 'server-only';

import { asPublic } from './db.ts';
import { trackedMatchupSql } from './playoff-policy.ts';

export interface HistoricalRecapPowerRow {
  espn_team_id: number;
  franchise_key: string;
  name: string;
  rank: number;
  score: string;
}

export interface HistoricalRecapLuckRow {
  espn_team_id: number;
  luck_delta: string;
}

export interface HistoricalRecapAllPlayRow {
  espn_team_id: number;
  all_play_wins: number;
  all_play_losses: number;
  scaled_wins: string | null;
  scaled_losses: string | null;
}

export interface HistoricalRecapGrudge {
  home_manager_key: string;
  home_manager_name: string;
  away_manager_key: string;
  away_manager_name: string;
  home_team_name: string;
  away_team_name: string;
  games: number;
  home_wins: number;
  away_wins: number;
  ties: number;
}

/**
 * Team-level context that can be reconstructed exactly from the recovered
 * 2005-2017 scoreboards. Nothing here depends on a player lineup, transaction,
 * or weekly ownership inference.
 */
export async function getHistoricalRecapExtras(season: number, week: number) {
  const tracked = trackedMatchupSql('m');
  const [power, luck, allPlay, grudgeRows] = await Promise.all([
    asPublic<HistoricalRecapPowerRow>(
      `select p.espn_team_id, fs.franchise_key, fs.team_name as name,
              p.rank::int, round(p.score, 4)::text as score
         from public.power_rankings p
         join public.franchise_season_teams fs
           on fs.season = p.season and fs.espn_team_id = p.espn_team_id
        where p.season = $1 and p.week = $2
        order by p.rank`,
      [season, week]
    ),
    asPublic<HistoricalRecapLuckRow>(
      `select espn_team_id, round(luck_delta, 2)::text as luck_delta
         from public.luck_index
        where season = $1 and week = $2
        order by luck_delta desc`,
      [season, week]
    ),
    asPublic<HistoricalRecapAllPlayRow>(
      `select r.espn_team_id,
              sum(r.all_play_wins)::int as all_play_wins,
              sum(r.all_play_losses)::int as all_play_losses,
              round(count(*) * sum(r.all_play_wins)::numeric
                    / nullif(sum(r.all_play_wins + r.all_play_losses), 0), 1)::text as scaled_wins,
              round(count(*) * sum(r.all_play_losses)::numeric
                    / nullif(sum(r.all_play_wins + r.all_play_losses), 0), 1)::text as scaled_losses
         from public.team_week_results r
        where r.season = $1 and r.week <= $2
          and r.all_play_wins is not null and r.all_play_losses is not null
        group by r.espn_team_id
        order by sum(r.all_play_wins)::numeric
                 / nullif(sum(r.all_play_wins + r.all_play_losses), 0) desc`,
      [season, week]
    ),
    asPublic<HistoricalRecapGrudge>(
      `with games as (
         select m.season, m.week, m.espn_matchup_id, m.winner,
                hms.manager_key as home_manager_key,
                hm.display_name as home_manager_name,
                ams.manager_key as away_manager_key,
                am.display_name as away_manager_name,
                hfs.team_name as home_team_name,
                afs.team_name as away_team_name
           from public.matchups m
           join public.franchise_season_teams hfs
             on hfs.season = m.season and hfs.espn_team_id = m.home_team_id
           join public.franchise_season_teams afs
             on afs.season = m.season and afs.espn_team_id = m.away_team_id
           join public.manager_franchise_seasons hms
             on hms.season = hfs.season and hms.franchise_key = hfs.franchise_key and hms.is_primary
           join public.manager_franchise_seasons ams
             on ams.season = afs.season and ams.franchise_key = afs.franchise_key and ams.is_primary
           join public.managers hm on hm.manager_key = hms.manager_key
           join public.managers am on am.manager_key = ams.manager_key
          where m.is_final and m.home_points is not null and m.away_points is not null
            and hms.manager_key <> ams.manager_key
            and (m.season < $1 or (m.season = $1 and m.week <= $2))
            and ${tracked}
       ), current_week as (
         select * from games where season = $1 and week = $2
       ), series as (
         select c.espn_matchup_id, c.home_manager_key, c.home_manager_name,
                c.away_manager_key, c.away_manager_name,
                c.home_team_name, c.away_team_name,
                count(*)::int as games,
                count(*) filter (where
                  (h.home_manager_key = c.home_manager_key and h.winner = 'HOME') or
                  (h.away_manager_key = c.home_manager_key and h.winner = 'AWAY'))::int as home_wins,
                count(*) filter (where h.winner = 'TIE')::int as ties
           from current_week c
           join games h on
             (h.home_manager_key = c.home_manager_key and h.away_manager_key = c.away_manager_key) or
             (h.home_manager_key = c.away_manager_key and h.away_manager_key = c.home_manager_key)
          group by c.espn_matchup_id, c.home_manager_key, c.home_manager_name,
                   c.away_manager_key, c.away_manager_name,
                   c.home_team_name, c.away_team_name
       )
       select home_manager_key, home_manager_name, away_manager_key, away_manager_name,
              home_team_name, away_team_name, games, home_wins,
              (games - home_wins - ties)::int as away_wins, ties
         from series
        order by games desc,
                 abs(home_wins - (games - home_wins - ties)) asc,
                 espn_matchup_id
        limit 1`,
      [season, week]
    ),
  ]);

  return { power, luck, allPlay, grudge: grudgeRows[0] ?? null };
}
