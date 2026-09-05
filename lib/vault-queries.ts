import 'server-only';

import { asPublic } from './db.ts';

export interface VaultSeasonSummary {
  season: number;
  team_count: number;
  games: number;
  decided_games: number;
  draft_picks: number;
  transactions: number;
  transaction_types: string | null;
}

export interface VaultGameRow {
  season: number;
  week: number;
  espn_matchup_id: number;
  home_team_id: number;
  home_name: string;
  home_points: string | null;
  away_team_id: number;
  away_name: string;
  away_points: string | null;
  winner: string;
  playoff_tier: string | null;
  is_final: boolean;
}

export interface VaultDraftPickRow {
  season: number;
  overall_pick: number;
  round: number;
  round_pick: number;
  espn_team_id: number;
  team_name: string;
  espn_player_id: number;
  player_name: string | null;
  position_id: number | null;
  is_keeper: boolean;
}

export interface VaultTransactionRow {
  espn_transaction_id: string;
  week: number;
  espn_team_id: number | null;
  team_name: string | null;
  type: string;
  status: string;
  bid_amount: string;
  proposed_at: string | null;
  item_count: number;
  players: string | null;
}

export interface VaultMomentRow {
  season: number;
  week: number;
  espn_matchup_id: number;
  winner_name: string;
  loser_name: string;
  winner_points: string;
  loser_points: string;
  margin: string;
}

export async function getVaultSeasons() {
  return asPublic<VaultSeasonSummary>(
    `select s.season,
            (select count(*)::int from public.teams t where t.season = s.season) as team_count,
            (select count(*)::int from public.matchups m where m.season = s.season) as games,
            (select count(*)::int from public.matchups m where m.season = s.season and m.is_final) as decided_games,
            (select count(*)::int from public.draft_picks d where d.season = s.season) as draft_picks,
            (select count(*)::int from public.transactions x where x.season = s.season) as transactions,
            (select string_agg(distinct x.type, ', ' order by x.type)
               from public.transactions x
              where x.season = s.season) as transaction_types
       from public.seasons s
      where s.season >= 2005
      order by s.season desc`
  );
}

export async function getVaultSeasonGames(season: number) {
  return asPublic<VaultGameRow>(
    `select m.season, m.week, m.espn_matchup_id,
            m.home_team_id, ht.name as home_name,
            round(m.home_points, 1)::text as home_points,
            m.away_team_id, at.name as away_name,
            round(m.away_points, 1)::text as away_points,
            m.winner, nullif(m.playoff_tier, 'NONE') as playoff_tier, m.is_final
       from public.matchups m
       join public.teams ht
         on ht.season = m.season and ht.espn_team_id = m.home_team_id
       join public.teams at
         on at.season = m.season and at.espn_team_id = m.away_team_id
      where m.season = $1
      order by m.week, m.espn_matchup_id`,
    [season]
  );
}

export async function getVaultSeasonDraft(season: number) {
  return asPublic<VaultDraftPickRow>(
    `select d.season, d.overall_pick, d.round, d.round_pick,
            d.espn_team_id, t.name as team_name,
            d.espn_player_id, p.full_name as player_name,
            p.default_position_id as position_id, d.is_keeper
       from public.draft_picks d
       join public.teams t
         on t.season = d.season and t.espn_team_id = d.espn_team_id
       left join public.players p using (espn_player_id)
      where d.season = $1
      order by d.overall_pick`,
    [season]
  );
}

export async function getVaultSeasonTransactions(season: number) {
  return asPublic<VaultTransactionRow>(
    `select x.espn_transaction_id, x.week, x.espn_team_id,
            t.name as team_name, x.type, x.status,
            round(x.bid_amount, 2)::text as bid_amount,
            x.proposed_at::text,
            count(i.id)::int as item_count,
            string_agg(
              distinct coalesce(p.full_name, case when i.espn_player_id is not null then 'ESPN #' || i.espn_player_id::text end),
              ', ' order by coalesce(p.full_name, case when i.espn_player_id is not null then 'ESPN #' || i.espn_player_id::text end)
            ) filter (where i.espn_player_id is not null) as players
       from public.transactions x
       left join public.teams t
         on t.season = x.season and t.espn_team_id = x.espn_team_id
       left join public.transaction_items i
         on i.espn_transaction_id = x.espn_transaction_id
       left join public.players p
         on p.espn_player_id = i.espn_player_id
      where x.season = $1 and x.type <> 'DRAFT'
      group by x.espn_transaction_id, x.week, x.espn_team_id, t.name,
               x.type, x.status, x.bid_amount, x.proposed_at
      order by x.week, x.proposed_at nulls last, x.espn_transaction_id`,
    [season]
  );
}

async function getVaultMoment(orderBy: string) {
  const rows = await asPublic<VaultMomentRow>(
    `select m.season, m.week, m.espn_matchup_id,
            case when m.winner = 'HOME' then ht.name else at.name end as winner_name,
            case when m.winner = 'HOME' then at.name else ht.name end as loser_name,
            round(case when m.winner = 'HOME' then m.home_points else m.away_points end, 1)::text as winner_points,
            round(case when m.winner = 'HOME' then m.away_points else m.home_points end, 1)::text as loser_points,
            round(abs(m.home_points - m.away_points), 1)::text as margin
       from public.matchups m
       join public.teams ht
         on ht.season = m.season and ht.espn_team_id = m.home_team_id
       join public.teams at
         on at.season = m.season and at.espn_team_id = m.away_team_id
      where m.season >= 2005 and m.is_final
        and m.winner in ('HOME', 'AWAY')
        and m.home_points is not null and m.away_points is not null
      order by ${orderBy}
      limit 1`
  );
  return rows[0] ?? null;
}

export function getVaultHighestScore() {
  return getVaultMoment(`greatest(m.home_points, m.away_points) desc, m.season, m.week`);
}

export function getVaultBiggestBlowout() {
  return getVaultMoment(`abs(m.home_points - m.away_points) desc, m.season, m.week`);
}

export function getVaultClosestFinish() {
  return getVaultMoment(`abs(m.home_points - m.away_points) asc, greatest(m.home_points, m.away_points) desc, m.season, m.week`);
}
