-- NFL production is independent of Grudge ownership and of the grading horizon.
-- Apply as owner. Additive, idempotent, public reads and pipeline-only writes.
begin;

create table if not exists public.nfl_players (
  player_key text primary key,
  full_name text not null,
  position text not null,
  bio jsonb not null default '{}'
);
create table if not exists public.nfl_player_aliases (
  season int not null check (season >= 2005),
  espn_player_id bigint not null,
  player_key text not null references public.nfl_players,
  match_method text not null,
  primary key (season, espn_player_id)
);
create index if not exists nfl_alias_player on public.nfl_player_aliases (player_key, season);

create table if not exists public.nfl_player_seasons (
  season int not null check (season >= 1999),
  player_key text not null references public.nfl_players,
  position text not null,
  teams text[] not null default '{}',
  primary key (season, player_key)
);
create index if not exists nfl_season_position on public.nfl_player_seasons (season, position, player_key);

create table if not exists public.nfl_player_games (
  season int not null check (season >= 1999),
  player_key text not null references public.nfl_players,
  season_type text not null check (season_type in ('REG', 'POST')),
  week int not null check (week between 1 and 25),
  game_id text not null,
  team text not null,
  opponent text not null,
  stats jsonb not null,
  fantasy_points numeric,
  calculated_points numeric,
  score_evidence text not null check (score_evidence in ('observed', 'reconstructed', 'unavailable', 'conflict', 'not_applicable')),
  primary key (season, player_key, season_type, week),
  foreign key (season, player_key) references public.nfl_player_seasons,
  check (season >= 2005 or (fantasy_points is null and calculated_points is null)),
  check ((score_evidence in ('observed', 'reconstructed')) = (fantasy_points is not null))
);
create index if not exists nfl_game_filter on public.nfl_player_games (season, season_type, week, player_key);
create index if not exists nfl_game_career on public.nfl_player_games (player_key, season desc, week);

create table if not exists public.player_archive_rosters (
  season int not null,
  espn_team_id int not null,
  player_key text not null references public.nfl_players,
  snapshot_kind text not null check (snapshot_kind in ('final', 'current')),
  primary key (season, espn_team_id, player_key)
);
create index if not exists player_archive_career on public.player_archive_rosters (player_key, season);

create table if not exists public.nfl_player_imports (
  season int primary key,
  input_hash text not null,
  model_version text not null,
  row_count int not null,
  regular_weeks int[] not null,
  postseason_weeks int[] not null,
  status text not null check (status in ('complete', 'in_progress', 'awaiting_games')),
  scoring_items jsonb,
  scoring_hash text,
  validation jsonb not null,
  sources jsonb not null,
  published_at timestamptz not null default now()
);

alter table public.nfl_players enable row level security;
alter table public.nfl_player_aliases enable row level security;
alter table public.nfl_player_seasons enable row level security;
alter table public.nfl_player_games enable row level security;
alter table public.player_archive_rosters enable row level security;
alter table public.nfl_player_imports enable row level security;

drop policy if exists public_read on public.nfl_players;
create policy public_read on public.nfl_players for select using (true);
drop policy if exists public_read on public.nfl_player_aliases;
create policy public_read on public.nfl_player_aliases for select using (true);
drop policy if exists public_read on public.nfl_player_seasons;
create policy public_read on public.nfl_player_seasons for select using (true);
drop policy if exists public_read on public.nfl_player_games;
create policy public_read on public.nfl_player_games for select using (true);
drop policy if exists public_read on public.player_archive_rosters;
create policy public_read on public.player_archive_rosters for select using (true);
drop policy if exists public_read on public.nfl_player_imports;
create policy public_read on public.nfl_player_imports for select using (true);

grant select on public.nfl_players, public.nfl_player_aliases, public.nfl_player_seasons,
  public.nfl_player_games, public.player_archive_rosters, public.nfl_player_imports to app_user, authenticated;
grant select, insert, update, delete on public.nfl_players, public.nfl_player_aliases, public.nfl_player_seasons,
  public.nfl_player_games, public.player_archive_rosters, public.nfl_player_imports to app_pipeline;

comment on table public.nfl_player_games is 'NFL game stats and season-specific Grudge scoring. A missing row is not a zero or a game played. NFL postseason is separate from REG.';
comment on table public.nfl_player_aliases is 'ESPN identities are season-scoped because early archives reuse a different ID namespace. Ambiguous matches retain an archive-only identity.';
commit;
