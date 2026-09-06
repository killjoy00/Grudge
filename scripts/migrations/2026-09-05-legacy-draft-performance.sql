-- Player-season fantasy totals used to grade recovered legacy draft boards.
--
-- ESPN's 2008-2017 season archives preserve exact full-season totals only for
-- players who survived on a final roster. Missing players are reconstructed
-- offline from nflverse weekly stats under that season's archived Grudge
-- scoring rules. The generated CSV is committed and imported here; the web app
-- never fetches third-party data at request time.

begin;

create table if not exists public.legacy_draft_performance (
  season              int not null,
  espn_player_id      bigint not null,
  fantasy_points      numeric(9,2) not null,
  source              text not null check (source in (
    'espn_exact',
    'nflverse_id',
    'nflverse_name',
    'no_regular_season_stats'
  )),
  source_player_id    text,
  primary key (season, espn_player_id),
  check (season between 2008 and 2017)
);

comment on table public.legacy_draft_performance is
  'Full-season QB/RB/WR/TE fantasy totals for 2008-2017 draft grading. Exact ESPN totals are preferred; missing final-roster players are reconstructed from nflverse using the archived season scoring rules.';
comment on column public.legacy_draft_performance.source is
  'espn_exact = archived ESPN appliedTotal; nflverse_id/name = validated scoring reconstruction; no_regular_season_stats = no regular-season stat row, therefore zero.';

create index if not exists legacy_draft_performance_season_idx
  on public.legacy_draft_performance (season, fantasy_points desc);

alter table public.legacy_draft_performance enable row level security;
grant select on public.legacy_draft_performance to authenticated, app_user;
grant select, insert, update, delete on public.legacy_draft_performance to app_pipeline;

drop policy if exists legacy_draft_performance_read on public.legacy_draft_performance;
create policy legacy_draft_performance_read on public.legacy_draft_performance
  for select to authenticated, app_user using (true);

commit;
