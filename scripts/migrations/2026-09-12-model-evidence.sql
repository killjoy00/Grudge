-- Apply as database owner before the model refresh workflow / web release.
begin;

-- Ownership remains in roster_entries. A score has exactly one player-week key.
create table if not exists public.player_week_scores (
  season int not null,
  week int not null check (week > 0),
  player_key text not null,
  espn_player_id bigint,
  position_id int,
  points numeric,
  evidence text not null check (evidence in ('observed', 'reconstructed', 'verified_zero', 'missing', 'conflict')),
  source text not null,
  scoring_version text not null,
  input_hash text not null,
  updated_at timestamptz not null default now(),
  primary key (season, week, player_key),
  unique (season, week, espn_player_id),
  check ((evidence in ('missing', 'conflict') and points is null)
      or (evidence in ('observed', 'reconstructed', 'verified_zero') and points is not null)),
  check (evidence <> 'verified_zero' or points = 0)
);

create index if not exists player_week_scores_player_idx on public.player_week_scores (season, espn_player_id, week);

create table if not exists public.player_season_profiles (
  season int not null,
  espn_player_id bigint not null,
  full_name text,
  position_id int,
  eligible_slots int[],
  primary key (season, espn_player_id)
);

-- Immutable runs and result rows; a tiny pointer publishes a complete run atomically.
create table if not exists public.model_runs (
  run_id text primary key,
  model_kind text not null check (model_kind in ('draft', 'trade')),
  model_version text not null,
  input_hash text not null,
  as_of_week int,
  coverage jsonb not null,
  created_at timestamptz not null default now(),
  unique (run_id, model_kind)
);
create table if not exists public.model_publications (
  model_kind text not null,
  season int not null,
  run_id text,
  coverage_status text not null default 'ready' check (coverage_status in ('ready', 'blocked')),
  coverage_detail jsonb not null default '{}'::jsonb,
  primary key (model_kind, season),
  foreign key (run_id, model_kind) references public.model_runs (run_id, model_kind)
);
create table if not exists public.draft_grade_results (
  run_id text not null references public.model_runs (run_id),
  season int not null,
  overall_pick int not null,
  espn_team_id int not null,
  espn_player_id bigint not null,
  result jsonb not null,
  primary key (run_id, season, overall_pick)
);
create table if not exists public.trade_grade_results (
  run_id text not null references public.model_runs (run_id),
  season int not null,
  trade_id text not null,
  trade_revision text not null,
  fit jsonb not null,
  production jsonb not null,
  primary key (run_id, season, trade_id)
);

alter table public.trades add column if not exists identity_key text;
alter table public.trades add column if not exists revision_hash text;
alter table public.trades add column if not exists evidence_status text not null default 'active'
  check (evidence_status in ('active', 'needs_review', 'retracted'));
alter table public.trades add column if not exists manually_corrected boolean not null default false;
alter table public.trades add column if not exists last_seen_at timestamptz;
alter table public.trades drop constraint if exists trades_confidence_check;
alter table public.trades add constraint trades_confidence_check check (confidence in ('ledger', 'reciprocal', 'manual'));
create unique index if not exists trades_identity_key_idx on public.trades (season, identity_key);

-- Corrections are append-only records; rebuilds never rewrite their payloads.
create table if not exists public.trade_corrections (
  correction_id text primary key,
  season int not null,
  trade_id text not null,
  reason text not null check (length(trim(reason)) > 0),
  correction jsonb not null,
  previous_record jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (season, trade_id) references public.trades (season, trade_id)
);

do $$
declare tab text;
begin
  foreach tab in array array['player_week_scores', 'player_season_profiles', 'model_runs', 'model_publications',
                             'draft_grade_results', 'trade_grade_results', 'trade_corrections'] loop
    execute format('alter table public.%I enable row level security', tab);
    execute format('alter table public.%I force row level security', tab);
    execute format('grant select on public.%I to app_user, authenticated', tab);
    execute format('grant select, insert on public.%I to app_pipeline', tab);
    execute format('drop policy if exists public_read on public.%I', tab);
    execute format('create policy public_read on public.%I for select to app_user, authenticated using (true)', tab);
  end loop;
end $$;
grant update on public.player_week_scores, public.player_season_profiles, public.model_publications to app_pipeline;
-- No pipeline DELETE grant on immutable model results or corrections.

create or replace function public.trade_voting_open(p_season int, p_trade_id text)
returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce((select t.evidence_status = 'active' and t.voting_closes_at > now()
    from public.trades t where t.season = p_season and t.trade_id = p_trade_id), false);
$$;

commit;
