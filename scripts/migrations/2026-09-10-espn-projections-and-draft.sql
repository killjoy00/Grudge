-- What ESPN expects to happen, captured BEFORE it happens -- and the draft.
--
-- ESPN publishes no win probability. What it does publish, for a week that
-- has not been played, is a projection for every player: the same
-- `stats` array the boxscore carries, with statSourceId 1 (projection) beside
-- statSourceId 0 (actual). Summing the ten starters gives the team total ESPN
-- shows in its own matchup view, and the higher total is the side ESPN is
-- picking. Verified against the live league on 2026-09-03: week 1 returns ten
-- starters and a projection for each on both sides of all five matchups.
--
-- WHY THIS HAS TO BE STORED RATHER THAN FETCHED WHEN SOMEONE OPENS THE PAGE.
--
-- A projection is a statement about the future and ESPN revises it right up to
-- kickoff -- an injury on Friday moves it. Reading it live would mean the
-- number shown on Sunday morning is not the number ESPN "predicted", and the
-- record kept against it would be scored against a forecast nobody ever saw.
-- So the Tuesday run takes one snapshot for the week ahead and that snapshot
-- is what the page shows and what the record is settled against. captured_at
-- is on the row for exactly that reason: the page says "as of Tuesday" and
-- means it.
--
-- ESPN's record is DERIVED, not stored as picks. There is no ESPN user, no
-- rows in `predictions`, and nothing in the pick-secrecy policies to work
-- around: its pick is a function of two numbers already on the row, and
-- reading it back out is a view. That also means it cannot drift out of step
-- with the projection it came from.
--
-- Run once as the Neon database owner. Idempotent: a retry is safe.

begin;

-- ------------------------------------------------------ matchup_projections

create table if not exists public.matchup_projections (
  season           int not null,
  week             int not null,
  espn_matchup_id  int not null,
  espn_team_id     int not null,
  -- Sum of the projections for the players ESPN had in starting slots at
  -- capture time. Bench and IR are excluded, the same way they are excluded
  -- from a real score.
  projected_points numeric(7,2) not null,
  -- How many starters that sum covers. A team with an empty slot projects low
  -- for a reason that is not weakness, and this is what lets the page tell
  -- the difference rather than quietly reporting a bad number.
  starters         int not null,
  captured_at      timestamptz not null default now(),
  primary key (season, week, espn_team_id),
  foreign key (season, espn_matchup_id)
    references public.matchups (season, espn_matchup_id) on delete cascade,
  foreign key (season, week) references public.weeks (season, week) on delete cascade
);

create index if not exists matchup_projections_matchup_idx
  on public.matchup_projections (season, espn_matchup_id);

comment on table public.matchup_projections is
  'ESPN''s pre-kickoff projected total per team, snapshotted once a week. Its pick is the higher total.';

-- ESPN's pick, and whether it came off. One row per matchup that has both
-- sides projected; `is_correct` is null while the game is undecided AND for a
-- tie, matching prediction_scores exactly -- a tie is a push there and must be
-- a push here, or the two records are not comparable.
--
-- A dead-even projection is a genuine non-pick rather than a coin flip
-- credited to ESPN, so it is excluded rather than scored.
create or replace view public.espn_matchup_picks
with (security_invoker = true) as
select m.season,
       m.week,
       m.espn_matchup_id,
       h.projected_points as home_projected,
       a.projected_points as away_projected,
       case when h.projected_points > a.projected_points then m.home_team_id
            else m.away_team_id end                      as predicted_winner_team_id,
       m.is_final,
       case when not m.is_final or m.winner = 'UNDECIDED' then null
            when m.winner = 'TIE'                        then null
            else (m.winner = 'HOME') = (h.projected_points > a.projected_points)
       end                                               as is_correct,
       greatest(h.captured_at, a.captured_at)            as captured_at
  from public.matchups m
  join public.matchup_projections h
    on h.season = m.season and h.espn_team_id = m.home_team_id and h.week = m.week
  join public.matchup_projections a
    on a.season = m.season and a.espn_team_id = m.away_team_id and a.week = m.week
 where h.projected_points <> a.projected_points;

-- The same shape prediction_leaderboard now carries, so the predictions page
-- can drop ESPN into the table beside the league without special-casing it.
create or replace view public.espn_prediction_record
with (security_invoker = true) as
select season,
       count(*)                                    as picks_made,
       count(is_correct)                           as decided,
       count(*) filter (where is_correct)          as correct,
       count(*) filter (where is_correct = false)  as incorrect,
       count(*) filter (where is_final and is_correct is null) as pushed,
       count(*) filter (where not is_final)        as pending,
       round((count(*) filter (where is_correct))::numeric
             / nullif(count(is_correct), 0)::numeric, 4) as accuracy
  from public.espn_matchup_picks
 group by season;

-- ------------------------------------------------------------- draft_picks
--
-- For the star-player reminder in week 1, when nobody has scored anything yet
-- and the only evidence of who a team's best players are is what it spent its
-- early picks on. From week 2 the page switches to actual scoring, so this is
-- read for roughly one week a year -- but it is also the league's draft board,
-- which is worth keeping on its own.
create table if not exists public.draft_picks (
  season         int not null,
  overall_pick   int not null,
  round          int not null,
  round_pick     int not null,
  espn_team_id   int not null,
  espn_player_id bigint not null,
  is_keeper      boolean not null default false,
  primary key (season, overall_pick),
  foreign key (season, espn_team_id) references public.teams (season, espn_team_id)
);

create index if not exists draft_picks_team_idx
  on public.draft_picks (season, espn_team_id, overall_pick);

comment on table public.draft_picks is
  'The league draft board, from ESPN mDraftDetail. Read in week 1 to name each team''s stars.';

-- ----------------------------------------------------------------- security
--
-- Both tables are league-public: a projection ESPN publishes and a draft
-- everybody watched. Neither is anyone's private pick, so read is open to
-- members and write belongs to the pipeline alone.
--
-- app_user needs the grant explicitly. The ALTER DEFAULT PRIVILEGES rule in
-- this database covers `authenticated` and not app_user, and app_user is the
-- role the web app connects as -- so leaving it out would not fail here or
-- trip a test, it would 500 the predictions page in production.

alter table public.matchup_projections enable row level security;
alter table public.draft_picks enable row level security;

grant select on public.matchup_projections, public.draft_picks to authenticated, app_user;
grant select on public.espn_matchup_picks, public.espn_prediction_record to authenticated, app_user;

-- BYPASSRLS is no help without the privilege itself.
grant select, insert, update, delete
  on public.matchup_projections, public.draft_picks to app_pipeline;

drop policy if exists matchup_projections_read on public.matchup_projections;
create policy matchup_projections_read on public.matchup_projections
  for select to authenticated, app_user using (true);

drop policy if exists draft_picks_read on public.draft_picks;
create policy draft_picks_read on public.draft_picks
  for select to authenticated, app_user using (true);

commit;
