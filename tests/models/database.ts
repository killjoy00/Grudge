import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { Stmt } from '../../pipeline/db.ts';

/** Real PostgreSQL semantics, with the production migration and query text. */
export async function modelDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role app_user; create role authenticated; create role app_pipeline bypassrls;
    create table seasons (season int primary key, team_count int, regular_season_weeks int, is_current boolean default false);
    create table weeks (season int, week int, results_complete boolean, primary key(season, week));
    create table matchups (season int, week int, home_team_id int, away_team_id int, playoff_tier text);
    create table roster_entries (season int, week int, espn_team_id int, espn_player_id bigint,
      lineup_slot_id int, is_starter boolean, applied_points numeric);
    create table players (espn_player_id bigint primary key, full_name text, default_position_id int, eligible_slots int[]);
    create table nfl_players (
      player_key text primary key,
      full_name text not null,
      position text not null,
      bio jsonb not null default '{}'
    );
    create table nfl_player_aliases (
      season int not null,
      espn_player_id bigint not null,
      player_key text not null references nfl_players(player_key),
      match_method text not null,
      primary key(season, espn_player_id)
    );
    create table draft_picks (season int, overall_pick int, round int, round_pick int,
      espn_team_id int, espn_player_id bigint, primary key(season, overall_pick));
    create table team_franchise (season int, espn_team_id int, franchise_key text, team_name text);
    create table manager_franchise_seasons (season int, franchise_key text, manager_key text, is_primary boolean);
    create table managers (manager_key text, display_name text);
    create table trades (season int, trade_id text, effective_week int, team_a int, team_b int,
      espn_transaction_id text, accepted_at timestamptz, confidence text default 'ledger',
      voting_closes_at timestamptz, primary key(season, trade_id));
    create table trade_players (season int, trade_id text, espn_player_id bigint, from_team_id int, to_team_id int,
      primary key(season, trade_id, espn_player_id), foreign key(season, trade_id) references trades on delete cascade);
    create table trade_votes (user_id text, season int, trade_id text, voted_team_id int,
      foreign key(season, trade_id) references trades on delete cascade);
    create function trade_voting_window() returns interval language sql immutable as $$ select interval '7 days' $$;
  `);
  await db.exec(readFileSync(new URL('../../scripts/migrations/2026-09-12-model-evidence.sql', import.meta.url), 'utf8'));
  await db.exec(`create view player_identity as
    select a.season,a.espn_player_id,a.player_key,null::text as full_name,
           coalesce(psp.position_id,p.default_position_id) as position_id,
           coalesce(psp.eligible_slots,p.eligible_slots) as eligible_slots
      from nfl_player_aliases a
      left join player_season_profiles psp on psp.season=a.season and psp.espn_player_id=a.espn_player_id
      left join players p on p.espn_player_id=a.espn_player_id;`);
  await db.exec(readFileSync(new URL('../../scripts/migrations/2026-09-17-canonical-trade-players.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../scripts/migrations/2026-09-18-canonical-draft-grade-players.sql', import.meta.url), 'utf8'));
  return db;
}
export async function execute(db: PGlite, statements: Stmt[]) {
  await db.transaction(async (tx) => {
    for (const statement of statements) await tx.query(statement.text, statement.params);
  });
}
