-- Trade history: derived trades, the players in them, and league votes.
--
-- WHY TRADES ARE DERIVED RATHER THAN READ
--
-- ESPN does not tell us what was in a trade. The only record it serves is a
-- TRADE_ACCEPT envelope with an EMPTY items array and a relatedTransactionId
-- pointing at a proposal that mTransactions2 never returns. Verified against
-- the live league on 2026-09-02: mTransactions2, mPendingTransactions and
-- kona_league_communication all return the accept with items:[] and nothing
-- else; the communication endpoint 401s without cookies.
--
-- So the contents are reconstructed from what ESPN DOES give us: weekly roster
-- snapshots plus the add/drop ledger. A player who is on team A in one weekly
-- snapshot and on team B in the next, with no ADD or DROP transaction covering
-- him in between, moved by trade. That reconstruction was checked against the
-- live league first -- replaying every draft, waiver and roster item over 161
-- players reproduced the current rosters with ZERO discrepancies -- so a
-- discrepancy really does mean a trade and not a gap in the ledger.
--
-- Seasons 2018-2025 have no transactions in the archive at all, but they DO
-- have complete weekly rosters, so they are recovered by the weaker of the two
-- rules: a two-way SWAP in one week is a trade, a lone move is left alone.
-- That found 26 trades across seven seasons against roughly 20 one-way waiver
-- moves per season -- a clean separation, and every one of them reads as a
-- real deal. `confidence` records which rule established each trade.
--
-- Run once as the Neon database owner. Idempotent: a retry is safe.

begin;

-- ------------------------------------------------------------------- trades

create table if not exists public.trades (
  season int not null,
  -- Deterministic and reproducible from the snapshots, so re-running the
  -- pipeline updates a trade in place instead of creating a second copy:
  -- "<season>-w<week>-<lowTeam>v<highTeam>".
  trade_id text not null,
  -- The first weekly snapshot in which the players appear on their new teams.
  -- Scoring counts from this week forward, because the trade was done before
  -- that week's games were played.
  effective_week int not null,
  team_a int not null,          -- always the lower espn_team_id
  team_b int not null,
  -- The TRADE_ACCEPT envelope, when exactly one lines up with the window.
  -- Null is normal and not a defect: the movement is the evidence, the
  -- envelope is only corroboration.
  espn_transaction_id text,
  accepted_at timestamptz,
  -- 'ledger' where transactions account for every free-agent move and an
  -- unexplained one is therefore a trade; 'reciprocal' where no transactions
  -- survive and only a two-way swap is safe to claim. See pipeline/
  -- trade-history.ts. The page states which, rather than presenting a
  -- reconstruction as a record.
  confidence text not null default 'ledger'
    check (confidence in ('ledger', 'reciprocal')),
  detected_at timestamptz not null default now(),
  primary key (season, trade_id),
  constraint trades_two_sides check (team_a < team_b)
);

create table if not exists public.trade_players (
  season int not null,
  trade_id text not null,
  espn_player_id bigint not null,
  from_team_id int not null,
  to_team_id int not null,
  primary key (season, trade_id, espn_player_id),
  foreign key (season, trade_id) references public.trades (season, trade_id) on delete cascade
);

create index if not exists trade_players_player_idx
  on public.trade_players (season, espn_player_id);

comment on table public.trades is
  'Trades reconstructed from weekly roster snapshots. ESPN serves no trade contents.';

-- ---------------------------------------------------- franchise resolution
--
-- The all-time trade rankings need a durable identity, and franchise_seasons
-- is written from RESULTS -- it holds nothing for a season until games are
-- played, so a preseason trade has no row to join to. This view falls back to
-- the most recent season in which that ESPN team id WAS resolved. Team ids are
-- stable in this league (team 9 has been the same franchise throughout), so
-- the fallback is sound; it is a view rather than repeated SQL so the rule
-- lives in one place.

create or replace view public.team_franchise as
select t.season,
       t.espn_team_id,
       t.name as team_name,
       coalesce(fs.franchise_key, prior.franchise_key) as franchise_key
  from public.teams t
  left join public.franchise_seasons fs
    on fs.season = t.season and fs.espn_team_id = t.espn_team_id
  left join lateral (
    select x.franchise_key
      from public.franchise_seasons x
     where x.espn_team_id = t.espn_team_id and x.season < t.season
     order by x.season desc
     limit 1
  ) prior on true;

-- security_invoker so the view reads the base tables with the CALLER's
-- privileges. Both are public-readable, so this changes nothing today; without
-- it, a future tightening of teams or franchise_seasons would leave this view
-- as an unnoticed way around it.
alter view public.team_franchise set (security_invoker = true);

comment on view public.team_franchise is
  'Season team -> durable franchise_key, falling back to the last season that resolved.';

-- -------------------------------------------------------------------- votes

create table if not exists public.trade_votes (
  user_id text not null references public.profiles (id) on delete cascade,
  season int not null,
  trade_id text not null,
  -- Which SIDE the voter thinks won: an espn_team_id, constrained by trigger
  -- below to one of the two teams actually in the trade.
  voted_team_id int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, season, trade_id),
  foreign key (season, trade_id) references public.trades (season, trade_id) on delete cascade
);

create index if not exists trade_votes_trade_idx on public.trade_votes (season, trade_id);

-- A vote for a team that is not in the trade is meaningless, and the tally
-- would silently carry it. Enforced in the database because the form is not
-- the only way to reach this table.
create or replace function public.enforce_trade_vote_side()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if not exists (
    select 1 from public.trades t
     where t.season = new.season and t.trade_id = new.trade_id
       and new.voted_team_id in (t.team_a, t.team_b)
  ) then
    raise exception 'not in trade' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trade_votes_side on public.trade_votes;
create trigger trade_votes_side
  before insert or update on public.trade_votes
  for each row execute function public.enforce_trade_vote_side();

-- Whether the caller has already voted on a trade. This is what makes the
-- tally hidden until you commit -- the same principle the predictions page
-- uses, so nobody can read the room before picking a side.
create or replace function public.has_voted_on_trade(p_season int, p_trade_id text)
returns boolean
language sql stable security definer
set search_path = public, app as $$
  select exists (
    select 1 from public.trade_votes v
     where v.season = p_season and v.trade_id = p_trade_id
       and v.user_id = app.current_user_id()
  );
$$;

revoke all on function public.has_voted_on_trade(int, text) from public;
grant execute on function public.has_voted_on_trade(int, text) to authenticated, app_user;

-- --------------------------------------------------------- grants and RLS

alter table public.trades enable row level security;
alter table public.trade_players enable row level security;
alter table public.trade_votes enable row level security;
-- FORCE so the table owner is bound by its own policies too. app_pipeline has
-- BYPASSRLS and writes these tables regardless; what force closes is the
-- owner-shaped hole, which RLS alone leaves open.
alter table public.trades force row level security;
alter table public.trade_players force row level security;
alter table public.trade_votes force row level security;

grant select on public.trades, public.trade_players to authenticated, app_user;
-- The weekly pipeline reconstructs these every run and is the only writer.
-- Without this grant BYPASSRLS is no help: the role would have no privilege to
-- bypass a policy on.
grant select, insert, update, delete on public.trades, public.trade_players to app_pipeline;
grant select on public.team_franchise to authenticated, app_user;
grant select, insert, update, delete on public.trade_votes to authenticated, app_user;

drop policy if exists trades_read on public.trades;
create policy trades_read on public.trades
  for select to authenticated, app_user using (true);

drop policy if exists trade_players_read on public.trade_players;
create policy trade_players_read on public.trade_players
  for select to authenticated, app_user using (true);

-- Your own vote always; everyone else's only once you have voted yourself.
drop policy if exists trade_votes_select on public.trade_votes;
create policy trade_votes_select on public.trade_votes
  for select to authenticated, app_user
  using (app.current_user_id() = user_id
         or public.has_voted_on_trade(season, trade_id));

drop policy if exists trade_votes_insert on public.trade_votes;
create policy trade_votes_insert on public.trade_votes
  for insert to authenticated, app_user
  with check (app.current_user_id() = user_id);

drop policy if exists trade_votes_update on public.trade_votes;
create policy trade_votes_update on public.trade_votes
  for update to authenticated, app_user
  using (app.current_user_id() = user_id)
  with check (app.current_user_id() = user_id);

drop policy if exists trade_votes_delete on public.trade_votes;
create policy trade_votes_delete on public.trade_votes
  for delete to authenticated, app_user
  using (app.current_user_id() = user_id);

commit;
