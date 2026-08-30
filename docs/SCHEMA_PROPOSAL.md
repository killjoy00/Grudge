# Step 2 — Schema proposal (NOT APPLIED)

Nothing in this document has been run. The SQL is here to be read and argued
with; once you approve it I will split it into numbered files under
`supabase/migrations/` and apply it.

Every design choice below traces to something confirmed in
[`exploration/FINDINGS.md`](../exploration/FINDINGS.md). Where it traces to an
assumption instead, it says so.

---

## Is Supabase the right tool? Yes — with two caveats that will bite you

You asked me to disagree if I disagreed. I don't, mostly.

**Why it fits.** Your hardest requirement is *"users cannot write predictions for
a locked week, enforced in the DB, not the UI."* Postgres RLS does exactly that,
and Supabase is the option where RLS and the auth session are wired together out
of the box — `auth.uid()` is available inside a policy with no glue code. Magic-link
email auth is built in. 13 users and ~50 MB of season data sit inside the free tier
with room to spare. The realistic alternative (Neon + Auth.js) means hand-wiring
JWT claims into Postgres session variables to get the same guarantee, which is more
code and more ways to get it wrong.

**Caveat 1 — free-tier projects pause after 7 days of inactivity.** In-season the
Tuesday pipeline keeps it warm. In the offseason it will pause, and the site's
data-backed pages will start erroring until you unpause it from the dashboard.
Not fatal, but don't be surprised in March. If that annoys you, Pro is $25/mo.

**Caveat 2 — Supabase's built-in email is not usable for what you want.** The
bundled SMTP is rate-limited to a handful of messages per hour and is explicitly
"for development only". You need it for two things: magic links (bursty — 10 people
logging in Sunday morning) and the Tuesday newsletter. **Both need custom SMTP.**
This is the single most common thing that breaks projects shaped like this one, so
it's in the setup steps as a required item, not an optional one. Resend's free tier
(3,000/month) covers you comfortably.

**Vercel: also yes.** Next.js App Router is Vercel's own framework; ISR for the
static pages, server components for the user-state pages, preview deploys per PR.
Hobby tier is fine for a league site. Its cron is limited to daily on Hobby, which
doesn't matter — your pipeline is on GitHub Actions anyway. `grudge.planitnow.us`
is a CNAME; steps are in `SETUP.md`.

The one thing I'd push back on is *scope*: playoff odds, power rankings, luck
index, optimal lineup, and a Monte Carlo are five separate modelling features, and
none of them can be validated until real games are played in September. I'd build
the pipeline and the plumbing now and hold the modelling until there's a single
real week of data to test against. Otherwise we tune against zeros.

---

## Shape of the design

Three groups of tables, distinguished by **who writes them**:

| group | writer | reader | RLS posture |
|---|---|---|---|
| ESPN mirror | pipeline (service role) | everyone | read-only to users; no write policies at all |
| Computed features | pipeline (service role) | everyone | same |
| User data | the user who owns the row | everyone (with rules) | ownership + lock enforced in policy |

The service role bypasses RLS by design — that is how the pipeline writes. The
consequence is that **the service-role key is the whole security model**, so it
lives only in GitHub Actions secrets and server-only Next.js code, never in
anything prefixed `NEXT_PUBLIC_`.

**Every ESPN table carries `season`.** History imported from 2018-2025 lands in
the *same* tables as 2026. Cross-season rivalry records then become an ordinary
query over `matchups` rather than a separate subsystem.

### Three facts from Step 1 that the schema has to respect

1. **Team IDs are not contiguous** (1-6, 8-11 — no 7). Nothing may assume
   `1..team_count`, and `espn_team_id` is never a surrogate key on its own.
2. **13 members own 10 teams** — three teams have co-owners. So `team_owners`
   is a join table, and **`profiles.espn_team_id` cannot be `UNIQUE`.** A
   uniqueness constraint there would lock one of the Wildfires out of the site.
3. **`matchupPeriodId` == `scoringPeriodId`** for this league (`matchupPeriodLength: 1`).
   I collapse both to a single `week` column. If the league ever moves to 2-week
   playoff matchups this assumption breaks, and it is flagged in the DDL comment.

---

## A. ESPN mirror

```sql
-- ---------------------------------------------------------------- seasons
create table public.seasons (
  season                int  primary key,
  league_name           text not null,
  team_count            int  not null,
  regular_season_weeks  int  not null,   -- scheduleSettings.matchupPeriodCount = 14
  playoff_team_count    int  not null,   -- scheduleSettings.playoffTeamCount   = 6
  final_scoring_period  int  not null,   -- 17
  faab_budget           numeric(8,2),    -- acquisitionSettings.acquisitionBudget = 100
  playoff_seeding_rule  text,            -- "TOTAL_POINTS_SCORED"
  is_current            boolean not null default false,
  settings_raw          jsonb   not null,
  updated_at            timestamptz not null default now()
);
-- Exactly one current season.
create unique index seasons_one_current on public.seasons (is_current) where is_current;

-- ---------------------------------------------------------------- members
-- ESPN account holders. members[].id is the SWID and is stored VERBATIM,
-- braces included: '{164FA15F-6CCC-4240-8ED4-940DC77B6F1A}'. Do not strip them.
create table public.members (
  season       int  not null references public.seasons(season) on delete cascade,
  swid         text not null,
  display_name text,
  first_name   text,
  last_name    text,
  primary key (season, swid)
);

-- ------------------------------------------------------------------ teams
create table public.teams (
  season            int  not null references public.seasons(season) on delete cascade,
  espn_team_id      int  not null,       -- NOT contiguous: 1-6, 8-11 in 2026
  name              text not null,
  abbrev            text,
  logo_url          text,
  division_id       int,
  primary_owner_swid text,
  waiver_rank       int,
  -- transactionCounter.acquisitionBudgetSpent -- ESPN's authoritative FAAB total
  faab_spent        numeric(8,2) not null default 0,
  primary key (season, espn_team_id)
);

-- ------------------------------------------------------------ team_owners
-- Many-to-one: a member owns one team, a team may have several owners.
create table public.team_owners (
  season       int  not null,
  espn_team_id int  not null,
  swid         text not null,
  is_primary   boolean not null default false,
  primary key (season, espn_team_id, swid),
  foreign key (season, espn_team_id) references public.teams(season, espn_team_id) on delete cascade,
  foreign key (season, swid)         references public.members(season, swid)      on delete cascade
);
create unique index team_owners_one_primary
  on public.team_owners (season, espn_team_id) where is_primary;

-- ------------------------------------------------------------------ weeks
-- THE LOCK TABLE. Load-bearing for prediction RLS -- see section C.
-- first_kickoff_at comes from proTeamSchedules_wl, which Step 1 confirmed gives
-- a real per-game timestamp. Weeks 16-17 contain flex-scheduled games with
-- startTimeTBD, so this must be REFRESHED WEEKLY, not computed once in August.
create table public.weeks (
  season           int not null references public.seasons(season) on delete cascade,
  week             int not null,          -- matchupPeriodId == scoringPeriodId here
  first_kickoff_at timestamptz,
  last_kickoff_at  timestamptz,
  has_tbd_kickoff  boolean not null default false,
  -- Separate from first_kickoff_at so you can override a lock without editing
  -- captured ESPN data (e.g. a week where ESPN's schedule is visibly wrong).
  locks_at         timestamptz,
  is_playoff       boolean not null default false,
  status           text not null default 'upcoming'
                   check (status in ('upcoming','in_progress','final')),
  -- Set true only when EVERY matchup in the week has a winner. The pipeline
  -- refuses to write derived rows for a week where this would be false.
  results_complete boolean not null default false,
  primary key (season, week)
);

-- ---------------------------------------------------------------- players
-- espn_player_id is stable across seasons, so this is not season-scoped.
-- defaultPositionId, derived in Step 1 from player names in the payload:
--   1=QB  2=RB  3=WR  4=TE  5=K  16=D/ST
create table public.players (
  espn_player_id      bigint primary key,
  full_name           text not null,
  default_position_id int,
  pro_team_id         int,
  updated_at          timestamptz not null default now()
);

-- ----------------------------------------------------------- lineup_slots
-- Seeded per season from settings.rosterSettings.lineupSlotCounts.
-- is_starter is COMPUTED AT LOAD as (slot_count > 0 AND id NOT IN (20,21)) and
-- stored, so the app never re-derives it and a settings change cannot silently
-- corrupt the optimal-lineup maths. 2026: starters 0,2,4,5,6,16,17,23; 20=bench,
-- 21=IR. eligible_position_ids was derived by inverting eligibleSlots, not assumed.
create table public.lineup_slots (
  season               int not null references public.seasons(season) on delete cascade,
  lineup_slot_id       int not null,
  slot_count           int not null,
  is_starter           boolean not null,
  eligible_position_ids int[] not null default '{}',
  label                text,             -- 'QB','RB','WR','WR/TE','TE','FLEX','D/ST','K','BE','IR'
  primary key (season, lineup_slot_id)
);

-- --------------------------------------------------------------- matchups
create table public.matchups (
  season           int not null,
  espn_matchup_id  int not null,          -- schedule[].id, stable
  week             int not null,
  home_team_id     int not null,
  away_team_id     int not null,
  home_points      numeric(8,2),
  away_points      numeric(8,2),
  winner           text not null default 'UNDECIDED'
                   check (winner in ('HOME','AWAY','TIE','UNDECIDED')),
  playoff_tier     text,                  -- null for regular season
  is_final         boolean not null default false,
  primary key (season, espn_matchup_id),
  foreign key (season, week)              references public.weeks(season, week) on delete cascade,
  foreign key (season, home_team_id)      references public.teams(season, espn_team_id),
  foreign key (season, away_team_id)      references public.teams(season, espn_team_id),
  check (home_team_id <> away_team_id)
);
create index matchups_week on public.matchups (season, week);

-- ------------------------------------------------------- team_week_results
create table public.team_week_results (
  season               int not null,
  week                 int not null,
  espn_team_id         int not null,
  opponent_team_id     int,
  points_for           numeric(8,2) not null,
  points_against       numeric(8,2) not null,
  result               text check (result in ('W','L','T')),
  -- optimal-vs-actual, from mBoxscore rosterForCurrentScoringPeriod
  optimal_points       numeric(8,2),
  points_left_on_bench numeric(8,2),
  -- luck-index inputs, stored so the flag is reproducible after the fact
  league_median        numeric(8,2),
  beat_median          boolean,
  all_play_wins        int,
  all_play_losses      int,
  -- running totals as of this week
  cum_wins             int, cum_losses int, cum_ties int,
  cum_points_for       numeric(9,2), cum_points_against numeric(9,2),
  primary key (season, week, espn_team_id),
  foreign key (season, week)         references public.weeks(season, week) on delete cascade,
  foreign key (season, espn_team_id) references public.teams(season, espn_team_id)
);

-- --------------------------------------------------------- roster_entries
-- Weekly lineup snapshot: the (slot, player, points) triple that optimal-vs-actual
-- needs. Source confirmed in Step 1:
--   mBoxscore -> schedule[].{home,away}.rosterForCurrentScoringPeriod.entries[]
-- NOTE: rosterForMatchupPeriod.entries is EMPTY in this league; do not use it.
create table public.roster_entries (
  season           int not null,
  week             int not null,
  espn_team_id     int not null,
  espn_player_id   bigint not null references public.players(espn_player_id),
  lineup_slot_id   int not null,
  is_starter       boolean not null,
  applied_points   numeric(7,2),
  projected_points numeric(7,2),
  acquisition_type text,
  injury_status    text,
  primary key (season, week, espn_team_id, espn_player_id),
  foreign key (season, week)         references public.weeks(season, week) on delete cascade,
  foreign key (season, espn_team_id) references public.teams(season, espn_team_id)
);
create index roster_entries_player on public.roster_entries (espn_player_id, season, week);
```

### Transactions — envelope + items, and why

Step 1 showed one transaction carries an `items[]` array. A trade is *one* record
with several items, so a flat table would either lose the grouping or duplicate the
envelope. Hence two tables.

`raw jsonb NOT NULL` is deliberate and important: **the only transaction type this
league has ever produced is `DRAFT`.** I have never seen an ADD, DROP, TRADE or
WAIVER record for it, so the `type`/`status` strings below are the ones I can
prove plus the ones I expect. Keeping the raw envelope means the first real waiver
claim in September tells us the truth without a re-fetch and without a lost record.
The `check` constraints are therefore deliberately permissive.

```sql
-- --------------------------------------------------------- transactions
create table public.transactions (
  espn_transaction_id text primary key,   -- ESPN's own uuid string
  season              int  not null,
  week                int  not null,      -- scoringPeriodId (draft attributed to 1)
  espn_team_id        int,
  type                text not null,      -- CONFIRMED: 'DRAFT'. Expected: ADD/DROP/TRADE/WAIVER
  status              text not null,      -- CONFIRMED: 'EXECUTED'
  execution_type      text,               -- CONFIRMED: 'EXECUTE'
  bid_amount          numeric(8,2) not null default 0,  -- FAAB bid
  is_pending          boolean not null default false,
  proposed_at         timestamptz,
  raw                 jsonb not null,     -- full envelope; see note above
  foreign key (season, week) references public.weeks(season, week) on delete cascade
);
create index transactions_team on public.transactions (season, espn_team_id, week);
create index transactions_type on public.transactions (season, type);

-- ---------------------------------------------------- transaction_items
create table public.transaction_items (
  id                  bigserial primary key,
  espn_transaction_id text not null references public.transactions(espn_transaction_id) on delete cascade,
  item_index          int  not null,
  espn_player_id      bigint references public.players(espn_player_id),
  item_type           text,
  from_team_id        int,   -- 0 = free agent pool / draft (NOT a real team id)
  to_team_id          int,
  from_lineup_slot_id int,   -- -1 = no prior slot
  to_lineup_slot_id   int,
  overall_pick_number int,
  is_keeper           boolean not null default false,
  unique (espn_transaction_id, item_index)
);
```

### The FAAB tracker

Two independent sources exist and **they must agree**:

- the ledger — `sum(bid_amount)` over each team's executed acquisitions
- the authority — `teams.faab_spent`, from ESPN's own `transactionCounter.acquisitionBudgetSpent`

Storing both and recording whether they reconcile turns a silent data bug into a
visible flag. If they diverge it almost certainly means a transaction type we
haven't seen yet is spending budget in a way the ingest didn't classify — exactly
the failure mode I'd otherwise never notice.

```sql
create table public.faab_ledger (
  season           int not null,
  week             int not null,
  espn_team_id     int not null,
  budget_total     numeric(8,2) not null,
  spent_this_week  numeric(8,2) not null default 0,
  spent_to_date    numeric(8,2) not null default 0,
  remaining        numeric(8,2) generated always as (budget_total - spent_to_date) stored,
  -- ESPN's own figure, carried through for comparison
  espn_reported_spent numeric(8,2),
  reconciles       boolean generated always as
                   (espn_reported_spent is null or abs(spent_to_date - espn_reported_spent) < 0.01) stored,
  primary key (season, week, espn_team_id),
  foreign key (season, week)         references public.weeks(season, week) on delete cascade,
  foreign key (season, espn_team_id) references public.teams(season, espn_team_id)
);

-- ------------------------------------------- player_ownership_snapshots (Step 8)
-- Weekly capture from kona_player_info + X-Fantasy-Filter, confirmed working
-- unauthenticated in Step 1. percent_change is ESPN's own w/w delta, which gives
-- an independent cross-check against our own snapshot-to-snapshot difference.
create table public.player_ownership_snapshots (
  season             int not null,
  week               int not null,
  espn_player_id     bigint not null references public.players(espn_player_id),
  percent_owned      numeric(5,2),
  percent_change     numeric(6,2),
  percent_started    numeric(5,2),
  auction_value_avg  numeric(6,2),
  avg_draft_position numeric(6,2),
  status             text,          -- 'FREEAGENT' | 'WAIVERS' | 'ONTEAM'
  on_team_id         int,           -- 0 when unowned
  captured_at        timestamptz not null default now(),
  primary key (season, week, espn_player_id),
  foreign key (season, week) references public.weeks(season, week) on delete cascade
);
```

---

## B. Computed features

All pipeline-written. `model_version` on each so a mid-season change to a formula
is visible rather than silently rewriting history, and `assumptions` on the Monte
Carlo so the scoring-distribution choices you asked to be explicit are stored with
the numbers they produced, not just in a code comment.

```sql
create table public.power_rankings (
  season int not null, week int not null, espn_team_id int not null,
  rank int not null,
  score numeric(8,4) not null,
  components jsonb not null,        -- {record, points_for, points_against, sos_adj}
  model_version text not null,
  primary key (season, week, espn_team_id),
  foreign key (season, week) references public.weeks(season, week) on delete cascade
);

create table public.luck_index (
  season int not null, week int not null, espn_team_id int not null,
  league_median  numeric(8,2) not null,
  points_for     numeric(8,2) not null,
  expected_wins  numeric(6,3) not null,   -- all-play win rate
  actual_wins    int not null,
  luck_delta     numeric(6,3) not null,   -- actual - expected, cumulative
  week_flag      text check (week_flag in ('UNLUCKY_LOSS','LUCKY_WIN')),
  model_version  text not null,
  primary key (season, week, espn_team_id),
  foreign key (season, week) references public.weeks(season, week) on delete cascade
);

create table public.playoff_odds (
  season int not null, week int not null, espn_team_id int not null,
  playoff_pct       numeric(5,4) not null,
  bye_pct           numeric(5,4),
  title_pct         numeric(5,4),
  seed_distribution jsonb not null,   -- {"1":0.12,"2":0.08,...}
  sim_count         int  not null,
  assumptions       jsonb not null,   -- distribution family, params, bracket rules
  model_version     text not null,
  primary key (season, week, espn_team_id),
  foreign key (season, week) references public.weeks(season, week) on delete cascade
);

create table public.weekly_awards (
  season int not null, week int not null,
  award_key text not null,            -- 'high_scorer','blowout','nailbiter','worst_bench'
  espn_team_id int,
  espn_player_id bigint references public.players(espn_player_id),
  value numeric(8,2),
  detail jsonb not null default '{}',
  primary key (season, week, award_key),
  foreign key (season, week) references public.weeks(season, week) on delete cascade
);
```

**Head-to-head rivalry** needs no table. Once history is imported into `matchups`,
it is a view:

```sql
create view public.head_to_head as
with sides as (
  select season, week, home_team_id as team_id, away_team_id as opp_id,
         home_points as pf, away_points as pa, winner = 'HOME' as won, winner = 'TIE' as tied
  from public.matchups where is_final
  union all
  select season, week, away_team_id, home_team_id,
         away_points, home_points, winner = 'AWAY', winner = 'TIE'
  from public.matchups where is_final
)
select team_id, opp_id,
       count(*) as games,
       count(*) filter (where won)  as wins,
       count(*) filter (where tied) as ties,
       count(*) filter (where not won and not tied) as losses,
       round(avg(pf), 2) as avg_points_for,
       round(avg(pa), 2) as avg_points_against,
       min(season) as first_season, max(season) as last_season
from sides group by team_id, opp_id;
```

✅ **Resolved.** This view joins on `espn_team_id` across seasons, which required
ESPN to reuse team IDs for the same franchise year to year. Checked directly
against the history backfill (`data/history/2018-2025`): all 10 team IDs map to
the same franchise name and the same `primaryOwner` SWID in every season 2018-2025
plus the live 2026 season. The join as written is correct.

One caveat the same data surfaced: **2020's captured payload looks unfinalized**
(`currentMatchupPeriod: 1`, every team's record and points at zero, no matchup
decided) despite the season having clearly been played in the real world. It's
in `data/history/2020` with a warning in its `manifest.json`. This view should
either exclude `season = 2020` or we find a request shape that returns 2020's
real results — flagging rather than deciding, since I haven't looked for one yet.

---

## C. User data — and the lock

### The allowlist is the gate

```sql
create extension if not exists citext;

create table public.league_allowlist (
  email        citext primary key,
  espn_swid    text,
  espn_team_id int,
  season       int  references public.seasons(season),
  is_admin     boolean not null default false,
  invited_at   timestamptz not null default now(),
  claimed_at   timestamptz
);

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         citext unique not null,
  espn_swid     text,
  -- DELIBERATELY NOT UNIQUE: teams 1, 5 and 10 have two owners each.
  espn_team_id  int,
  display_name  text,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

Signup is gated by a trigger on `auth.users`, which fails closed — an email not on
the allowlist cannot create an account even if someone hits the auth API directly:

```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare a public.league_allowlist%rowtype;
begin
  select * into a from public.league_allowlist where email = lower(new.email);
  if not found then
    raise exception 'Email % is not on the league allowlist', new.email
      using errcode = '42501';
  end if;
  insert into public.profiles (id, email, espn_swid, espn_team_id, is_admin, display_name)
  values (new.id, lower(new.email), a.espn_swid, a.espn_team_id, a.is_admin,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)));
  update public.league_allowlist set claimed_at = now() where email = lower(new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
```

This also answers *"after login, users pick or are assigned their ESPN team"* —
the allowlist row carries the team, so the profile is provisioned correctly on
first login with nothing to pick. (If you'd rather people self-select, drop
`espn_team_id` from the allowlist and I'll add a one-time claim flow instead.)

### Privilege escalation — the hole worth naming

The obvious profile policy is necessary but **not sufficient on its own**:

```sql
-- Correct for ROW ownership -- but see below: by itself it is a security hole.
alter table public.profiles enable row level security;
alter table public.profiles force  row level security;

create policy profiles_select on public.profiles
  for select to authenticated using (true);

create policy profiles_update on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
```

That satisfies "users write only their own rows" *and still lets any user set
their own `is_admin = true`*, which would defeat all of Step 8. RLS is row-level;
it has nothing to say about **which columns** changed. So it needs two further
defences layered on top:

```sql
-- 1. column-level grant: authenticated simply cannot write these columns
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- 2. trigger, in case a future grant is widened by accident.
-- auth.uid() is null for the service role, so the pipeline is unaffected.
-- SECURITY DEFINER is load-bearing: without it the function runs as the calling
-- role, and a role lacking USAGE on schema auth makes the trigger ERROR rather
-- than block cleanly. Caught by the T7 attack test.
create or replace function public.prevent_profile_escalation()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is not null and (
       new.is_admin     is distinct from old.is_admin
    or new.espn_team_id is distinct from old.espn_team_id
    or new.espn_swid    is distinct from old.espn_swid
    or new.email        is distinct from old.email) then
    raise exception 'cannot modify privileged profile columns' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_no_escalation
  before update on public.profiles for each row
  execute function public.prevent_profile_escalation();
```

### Lock helpers — both fail closed

```sql
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Returns TRUE (locked) when the week is unknown. An unknown week must never be
-- writable: a typo'd week number is not an open week.
create or replace function public.week_is_locked(p_season int, p_week int)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select now() >= coalesce(locks_at, first_kickoff_at)
       from public.weeks where season = p_season and week = p_week),
    true);
$$;
```

### Predictions

```sql
create table public.predictions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  season       int  not null,
  week         int  not null,
  espn_matchup_id int not null,
  predicted_winner_team_id int not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, season, espn_matchup_id),
  foreign key (season, week)            references public.weeks(season, week) on delete cascade,
  foreign key (season, espn_matchup_id) references public.matchups(season, espn_matchup_id) on delete cascade
);

-- The picked team must actually be in that matchup -- a CHECK cannot reach
-- another table, so this is a trigger.
create or replace function public.validate_prediction_team()
returns trigger language plpgsql security definer set search_path = public as $$
declare h int; a int; w int;
begin
  select home_team_id, away_team_id, week into h, a, w
    from public.matchups
   where season = new.season and espn_matchup_id = new.espn_matchup_id;
  if not found then raise exception 'no such matchup'; end if;
  if new.predicted_winner_team_id not in (h, a) then
    raise exception 'team % is not in matchup %', new.predicted_winner_team_id, new.espn_matchup_id;
  end if;
  if new.week <> w then raise exception 'week does not match the matchup'; end if;
  return new;
end $$;

create trigger predictions_validate_team
  before insert or update on public.predictions for each row
  execute function public.validate_prediction_team();
```

**The lock, enforced twice.** RLS is the primary gate. The trigger is defence in
depth — it also catches a service-role mistake, which RLS by definition cannot,
and the pipeline never writes this table so it costs nothing:

```sql
alter table public.predictions enable row level security;

-- Own picks always visible; everyone else's only once the week locks, so nobody
-- can copy picks before kickoff.
create policy predictions_select on public.predictions for select to authenticated
  using (auth.uid() = user_id or public.week_is_locked(season, week));

create policy predictions_insert on public.predictions for insert to authenticated
  with check (auth.uid() = user_id and not public.week_is_locked(season, week));

create policy predictions_update on public.predictions for update to authenticated
  using      (auth.uid() = user_id and not public.week_is_locked(season, week))
  with check (auth.uid() = user_id and not public.week_is_locked(season, week));

create policy predictions_delete on public.predictions for delete to authenticated
  using (auth.uid() = user_id and not public.week_is_locked(season, week));

create or replace function public.enforce_prediction_lock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.week_is_locked(new.season, new.week)
     and current_setting('app.allow_locked_writes', true) is distinct from 'on' then
    raise exception 'week %/% is locked', new.season, new.week using errcode = '55000';
  end if;
  return new;
end $$;

create trigger predictions_lock_guard
  before insert or update on public.predictions for each row
  execute function public.enforce_prediction_lock();
```

Scoring lives in its own table so users have no write path to it at all — there is
simply no INSERT or UPDATE policy, and no grant:

```sql
create table public.prediction_scores (
  prediction_id uuid primary key references public.predictions(id) on delete cascade,
  is_correct    boolean not null,
  points        numeric(6,2) not null default 1,
  scored_at     timestamptz not null default now()
);
alter table public.prediction_scores enable row level security;
create policy prediction_scores_select on public.prediction_scores
  for select to authenticated using (true);
-- no insert/update/delete policies: service role only.

create view public.prediction_leaderboard as
select p.user_id, pr.display_name, p.season,
       count(*) as picks_made,
       count(*) filter (where s.is_correct) as correct,
       coalesce(sum(s.points), 0) as points,
       round(count(*) filter (where s.is_correct)::numeric
             / nullif(count(s.prediction_id), 0), 4) as accuracy
from public.predictions p
join public.profiles pr on pr.id = p.user_id
left join public.prediction_scores s on s.prediction_id = p.id
group by p.user_id, pr.display_name, p.season;
```

### Comments

Soft-deleted so a deleted parent doesn't orphan its replies.

```sql
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  season     int not null,
  week       int not null,
  parent_id  uuid references public.comments(id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (season, week) references public.weeks(season, week) on delete cascade
);
create index comments_thread on public.comments (season, week, created_at);

alter table public.comments enable row level security;
create policy comments_select on public.comments for select to authenticated using (true);
create policy comments_insert on public.comments for insert to authenticated
  with check (auth.uid() = user_id);
create policy comments_update on public.comments for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy comments_delete on public.comments for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());
```

### Read-only posture for every mirror + computed table

Written as a loop rather than as a template, so there is no way to apply the
schema and quietly leave a table unprotected. An earlier draft of this document
expressed this as pseudo-code and my own attack test then read the entire
allowlist as a non-admin — because the pseudo-code had never actually run.

```sql
-- Publicly readable mirror + computed tables: read for any signed-in member,
-- no write policies at all, so the service role is the only writer.
do $$
declare t text;
begin
  foreach t in array array[
    'seasons','members','teams','team_owners','weeks','players','lineup_slots',
    'matchups','team_week_results','roster_entries','transactions',
    'transaction_items','faab_ledger','power_rankings','luck_index',
    'playoff_odds','weekly_awards'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format(
      'revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- Admin-only. Not readable by regular members: it contains everyone's email.
alter table public.league_allowlist enable row level security;
alter table public.league_allowlist force row level security;
create policy allowlist_admin_read on public.league_allowlist
  for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.league_allowlist from authenticated;

-- Ownership snapshots are an admin feature (Step 8), gated in the DB as well as
-- the route, so a non-admin hitting PostgREST directly gets nothing.
alter table public.player_ownership_snapshots enable row level security;
alter table public.player_ownership_snapshots force row level security;
create policy ownership_admin_read on public.player_ownership_snapshots
  for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.player_ownership_snapshots from authenticated;

-- profiles / predictions / comments keep their own policies from above.
-- ENABLE and FORCE are different things and both are needed -- see the warning.
alter table public.predictions       force row level security;
alter table public.prediction_scores force row level security;
alter table public.comments          force row level security;
```

⚠️ **`force` without `enable` is a silent no-op.** `FORCE ROW LEVEL SECURITY`
only takes effect on a table where RLS is already *enabled*; on its own it
leaves the table completely unprotected while looking protected in the
migration. An earlier draft of this document did exactly that to `profiles`,
and the T7 attack test then successfully edited another user's row. Both
statements, on every table, or neither.

The two are for different threats: `enable` applies policies to ordinary roles;
`force` additionally applies them to the table's **owner**, so a migration or
psql session running as the owner cannot quietly bypass every policy above.

---

## What I need from you before I run any of this

1. **Approve or redline the above.** Particularly: hiding other people's picks
   until lock, soft-deleting comments, and auto-assigning teams from the allowlist
   rather than letting people choose.
2. **The allowlist**, as `email, espn_team_id, is_admin` — 13 rows. I have the
   SWIDs and names from Step 1, so email + team is enough and I'll join the rest.
3. **Confirm the Monte Carlo bracket assumption**: 6 of 10 teams, top 2 seeds get
   byes, 3v6 and 4v5 in round one, no reseeding (`playoffReseed: false`), seeding
   ties broken by total points (`TOTAL_POINTS_SCORED`). The bracket isn't in the
   API yet, so this is my reading of the settings, not confirmed data.

## Still unverified, carried forward from Step 1

- Non-`DRAFT` transaction shapes — mitigated by `transactions.raw`.
- Whether `mTransactions2` returns full history or a rolling window all season.
- Weekly actual stat rows (`statSourceId: 0`, nonzero `scoringPeriodId`) — inferred
  from the projected-weekly rows' shape, not observed.
- ~~Whether ESPN reuses team IDs across seasons~~ — **resolved**, see §head_to_head
  above. Yes, consistently, for all 10 teams across all 8 imported seasons.
- **New from the backfill:** `data/history/2020` looks unfinalized (zero scores,
  no decided matchups) despite the season having been played. Not yet
  root-caused — see `exploration/FINDINGS.md` §9.
