-- Attack suite for the RLS model. Each case asserts an outcome and records
-- PASS/FAIL; the file raises at the end if anything failed, so it is usable
-- as a CI gate rather than something a human has to eyeball.
--
-- Two distinct failure shapes are checked, because RLS produces both:
--   * a raised ERROR      (grant denied, or a trigger refusing the write)
--   * a silent 0 ROWS     (policy filtered the row out -- no error at all)
-- Only checking for errors would miss every policy bug of the second kind.
--
-- Identity is driven through `app.user_id`, the per-request session setting
-- the Next.js server writes after verifying a Clerk session -- the same
-- mechanism production uses, so these tests exercise the real path rather than
-- a simulation of one. (app.current_user_id() also falls back to a
-- Neon-validated JWT; that path is unavailable -- see the schema doc.)
--
-- Every policy, trigger and lock-enforcement mechanism here carries through
-- unchanged from the Supabase draft. These tests are why that is checked
-- rather than asserted.

create schema if not exists test;

create table if not exists test.results (
  id      serial primary key,
  label   text not null,
  ok      boolean not null,
  detail  text
);

create or replace function test.record(p_label text, p_ok boolean, p_detail text)
returns void language sql as $$
  insert into test.results (label, ok, detail) values (p_label, p_ok, p_detail);
$$;

-- Expects the statement to raise.
create or replace function test.expect_error(p_stmt text, p_label text)
returns void language plpgsql as $$
begin
  execute p_stmt;
  perform test.record(p_label, false, 'statement unexpectedly SUCCEEDED');
exception when others then
  perform test.record(p_label, true, sqlerrm);
end $$;

-- Expects the statement to succeed.
create or replace function test.expect_ok(p_stmt text, p_label text)
returns void language plpgsql as $$
begin
  execute p_stmt;
  perform test.record(p_label, true, null);
exception when others then
  perform test.record(p_label, false, 'unexpectedly FAILED: ' || sqlerrm);
end $$;

-- Expects the statement to touch exactly N rows. This is how a policy that
-- silently filters (rather than erroring) gets caught.
create or replace function test.expect_rowcount(p_stmt text, p_expected int, p_label text)
returns void language plpgsql as $$
declare n int;
begin
  execute p_stmt;
  get diagnostics n = row_count;
  perform test.record(p_label, n = p_expected,
    case when n = p_expected then null
         else format('affected %s rows, expected %s', n, p_expected) end);
exception when others then
  perform test.record(p_label, false, 'unexpectedly FAILED: ' || sqlerrm);
end $$;

-- Expects a scalar count query to return N.
create or replace function test.expect_count(p_query text, p_expected int, p_label text)
returns void language plpgsql as $$
declare n int;
begin
  execute p_query into n;
  perform test.record(p_label, n = p_expected,
    case when n = p_expected then null
         else format('saw %s, expected %s', n, p_expected) end);
exception when others then
  perform test.record(p_label, false, 'unexpectedly FAILED: ' || sqlerrm);
end $$;

grant usage on schema test to authenticated, app_user, app_pipeline, app_provisioner;
grant select, insert on test.results to authenticated, app_user, app_pipeline, app_provisioner;
grant usage, select on sequence test.results_id_seq to authenticated, app_user, app_pipeline, app_provisioner;
grant execute on all functions in schema test to authenticated, app_user, app_pipeline, app_provisioner;

-- Clerk-style user ids (Clerk's real ones look like "user_2abc...").
-- \set is a psql client-side substitution, not SQL -- it happens before the
-- server ever sees these strings, so it's safe to reuse them below.
\set owner_id 'user_test_owner_0001'
\set admin_id 'user_test_admin_0001'
\set stranger_id 'user_test_stranger_0001'

-- ================================================ profile provisioning (webhook) ==
-- app_provisioner is the only role holding execute on provision_profile. It
-- stands in for the Clerk webhook handler's narrowly scoped credential and,
-- unlike app_pipeline, does not bypass RLS.
set role app_provisioner;

select test.expect_ok(
  format($$select public.provision_profile('%s', 'owner@example.com', 'Ryan')$$, :'owner_id'),
  'T1  webhook can provision an allowlisted non-admin');

select test.expect_ok(
  format($$select public.provision_profile('%s', 'boss@example.com', 'Jordan')$$, :'admin_id'),
  'T2  webhook can provision an allowlisted admin');

select test.expect_error(
  format($$select public.provision_profile('%s', 'stranger@evil.com', 'Nobody')$$, :'stranger_id'),
  'T3  ATTACK provision a NON-allowlisted email');

-- Diagnostic check, not an app_provisioner capability test -- unrestricted.
-- app_provisioner itself has no direct SELECT grant on profiles (correctly:
-- only provision_profile()'s SECURITY DEFINER context touches that table).
reset role;

select test.expect_count(
  $$select count(*) from public.profiles where is_admin$$, 1,
  'T4  admin flag provisioned from allowlist, not self-declared');

select test.expect_error(
  format($$select public.provision_profile('%s', 'stranger@evil.com', 'Nobody')$$, :'stranger_id'),
  'T5  ATTACK call provision_profile directly as a plain session (no grant)');

-- ====================================================== as a NON-ADMIN user ==
set role app_user;
set app.user_id = :'owner_id';

select test.expect_error(
  $$update public.profiles set is_admin = true where id = app.current_user_id()$$,
  'T6  ATTACK self-elevate to admin');

select test.expect_error(
  $$update public.profiles set espn_team_id = 99 where id = app.current_user_id()$$,
  'T7  ATTACK reassign own ESPN team');

select test.expect_rowcount(
  $$update public.profiles set display_name = 'Ryan M.' where id = app.current_user_id()$$, 1,
  'T8  legitimate display_name change works');

select test.expect_rowcount(
  format($$update public.profiles set display_name = 'pwned' where id = '%s'$$, :'admin_id'),
  0,
  'T9  ATTACK edit another user profile');

select test.expect_count(
  $$select count(*) from public.league_allowlist$$, 0,
  'T10 ATTACK read allowlist (everyone emails) as non-admin');

-- ============================================================= predictions ==
select test.expect_ok(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (app.current_user_id(),2026,1,1,6)$$,
  'T11 pick in an OPEN week is allowed');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (app.current_user_id(),2026,2,11,1)$$,
  'T12 ATTACK pick in a LOCKED week');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (app.current_user_id(),2026,1,2,6)$$,
  'T13 ATTACK pick a team that is not in the matchup');

select test.expect_error(
  format($$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values ('%s',2026,1,2,11)$$, :'admin_id'),
  'T14 ATTACK submit a pick as another user');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (app.current_user_id(),2026,99,1,6)$$,
  'T15 ATTACK unknown week (lock helper must fail CLOSED)');

select test.expect_error(
  $$insert into public.prediction_scores (prediction_id,is_correct,points)
    select id,true,100 from public.predictions where user_id = app.current_user_id() limit 1$$,
  'T16 ATTACK award yourself prediction points');

-- Seed a locked-week pick as the connecting superuser (unrestricted, bypasses
-- everything unconditionally) purely to set up the fixture -- not standing in
-- for any production role. app_pipeline itself is never granted direct write
-- access to predictions: nothing in the real design needs it, since the
-- pipeline's only write path into this table's orbit is prediction_scores,
-- populated by scoring picks after the fact, never predictions rows themselves.
reset role; reset app.user_id;
set app.allow_locked_writes = 'on';
insert into public.predictions (id,user_id,season,week,espn_matchup_id,predicted_winner_team_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', :'owner_id', 2026,2,11,1);
reset app.allow_locked_writes;
-- A rival's pick in the OPEN week, for the secrecy check.
insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
values (:'admin_id', 2026,1,1,1);

set role app_user;
set app.user_id = :'owner_id';

select test.expect_rowcount(
  $$update public.predictions set predicted_winner_team_id = 6
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 0,
  'T17 ATTACK change a pick after kickoff');

select test.expect_rowcount(
  $$delete from public.predictions
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 0,
  'T18 ATTACK delete a pick after kickoff');

select test.expect_count(
  $$select count(*) from public.predictions where week = 1$$, 1,
  'T19 pick secrecy: rival OPEN-week picks are hidden');

select test.expect_count(
  $$select count(*) from public.predictions where week = 2$$, 1,
  'T20 locked-week picks become visible to everyone');

-- ========================================================== as an ADMIN user ==
set app.user_id = :'admin_id';

select test.expect_count(
  $$select count(*) from public.league_allowlist$$, 2,
  'T21 admin CAN read the allowlist');

select test.expect_error(
  format($$update public.profiles set is_admin = true where id = '%s'$$, :'owner_id'),
  'T22 even an admin cannot grant admin via the client');

-- ============================================ identity cannot leak across requests ==
-- SET LOCAL scopes app.user_id to the transaction, so a pooled connection
-- cannot carry one request's identity into the next. Simulate the next request
-- by clearing it: the same session must immediately stop being anybody.
reset app.user_id;

-- Week 1 is OPEN, so its picks are visible only to their owner. Week 2 is
-- LOCKED and deliberately public (T20), so it must be excluded here -- counting
-- all predictions would fail against correct behavior.
select test.expect_count(
  $$select count(*) from public.predictions where week = 1$$, 0,
  'T25 identity cleared -> open-week picks invisible (no leak to next request)');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values ('user_test_owner_0001',2026,1,2,11)$$,
  'T26 identity cleared -> cannot write as the previous user');

-- ================================================================== summary ==
reset role; reset app.user_id;

select test.expect_count(
  $$select count(*) from public.team_owners where season=2026 and espn_team_id=1$$, 2,
  'T23 co-ownership: two members share one team');

-- Explicit role switch, not a bare reset: the session otherwise reverts to the
-- connecting superuser, which bypasses RLS unconditionally and would pass this
-- test regardless of whether app_pipeline's own grant is correct.
set role app_pipeline;
select test.expect_ok(
  $$insert into public.matchups (season, espn_matchup_id, week, home_team_id, away_team_id)
    select 2026, 999, 1, 6, 11$$,
  'T24 app_pipeline (BYPASSRLS) can write the ESPN-mirror tables');
reset role;

-- =========================================== admin-only tables (Step 8) ==
-- The free-agent pool is admin-only. These run as app_user with an explicit
-- role switch, NOT after a bare `reset role` -- the connecting superuser
-- bypasses RLS unconditionally and would pass every check below regardless of
-- whether the policy exists at all.
--
-- The point of this block is that the DATABASE refuses, not the route guard in
-- lib/admin.ts. Deleting that guard must leave a non-admin seeing nothing.
set role app_user;
set app.user_id = :'owner_id';   -- provisioned non-admin

-- Zero rows, not an error: RLS filters, it does not raise. That distinction
-- matters because a route that "works but returns nothing" is what a non-admin
-- must experience if a guard is ever removed.
select test.expect_count(
  $$select count(*) from public.player_ownership_snapshots$$, 0,
  'T27 ATTACK read the free-agent pool as a non-admin');

select test.expect_error(
  $$insert into public.player_ownership_snapshots (season, week, espn_player_id, percent_owned)
    values (2026, 1, 4685415, 99.9)$$,
  'T28 ATTACK write a pool snapshot as a non-admin');

select test.expect_error(
  $$update public.player_ownership_snapshots set percent_owned = 0 where season = 2026$$,
  'T29 ATTACK tamper with captured ownership as a non-admin');

-- The positive control. Without it, a policy of `using (false)` would pass
-- every check above while making the admin page permanently empty.
set app.user_id = :'admin_id';
select test.expect_count(
  $$select count(*) from public.player_ownership_snapshots$$, 2,
  'T30 admin CAN read the free-agent pool');

-- Admins read the pool; they never write it. That is the pipeline's job, and
-- an admin session with write access would let the UI corrupt captured history.
select test.expect_error(
  $$update public.player_ownership_snapshots set percent_owned = 0 where season = 2026$$,
  'T31 even an admin cannot rewrite captured ownership');

reset app.user_id;
select test.expect_count(
  $$select count(*) from public.player_ownership_snapshots$$, 0,
  'T32 identity cleared -> pool invisible');

reset role; reset app.user_id;

\echo ''
\pset format aligned
select case when ok then 'pass' else 'FAIL' end as status, label, detail
from test.results order by id;

do $$
declare failed int;
begin
  select count(*) into failed from test.results where not ok;
  raise notice '% / % checks passed',
    (select count(*) from test.results where ok), (select count(*) from test.results);
  if failed > 0 then
    raise exception '% RLS check(s) FAILED', failed;
  end if;
end $$;
