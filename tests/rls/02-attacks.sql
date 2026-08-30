-- Attack suite for the RLS model. Each case asserts an outcome and records
-- PASS/FAIL; the file raises at the end if anything failed, so it is usable
-- as a CI gate rather than something a human has to eyeball.
--
-- Two distinct failure shapes are checked, because RLS produces both:
--   * a raised ERROR      (grant denied, or a trigger refusing the write)
--   * a silent 0 ROWS     (policy filtered the row out -- no error at all)
-- Only checking for errors would miss every policy bug of the second kind.
--
-- Ported from the Supabase-shaped version of this suite when the stack moved
-- to Neon + Clerk. What changed: profiles.id is now a Clerk-style text user
-- id, not a Postgres uuid; there is no auth.users table to insert into, so
-- the old "signup" tests (which exercised a trigger on it) are replaced with
-- tests of provision_profile(), the function a Clerk webhook would call.
-- What did NOT change: every policy, trigger, and lock-enforcement mechanism
-- below is the same logic as before, just auth.uid() renamed to
-- auth.user_id() throughout -- these tests are why that claim isn't just
-- assumed.

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

grant usage on schema test to authenticated, app_pipeline;
grant select, insert on test.results to authenticated, app_pipeline;
grant usage, select on sequence test.results_id_seq to authenticated, app_pipeline;
grant execute on all functions in schema test to authenticated, app_pipeline;

-- Clerk-style user ids (Clerk's real ones look like "user_2abc...").
-- \set is a psql client-side substitution, not SQL -- it happens before the
-- server ever sees these strings, so it's safe to reuse them below.
\set owner_id 'user_test_owner_0001'
\set admin_id 'user_test_admin_0001'
\set stranger_id 'user_test_stranger_0001'

-- ================================================ profile provisioning (webhook) ==
-- app_pipeline is the only role holding execute on provision_profile -- it
-- stands in for the Clerk webhook handler's server-side credential.
set role app_pipeline;

select test.expect_ok(
  format($$select public.provision_profile('%s', 'owner@example.com', 'Ryan')$$, :'owner_id'),
  'T1  webhook can provision an allowlisted non-admin');

select test.expect_ok(
  format($$select public.provision_profile('%s', 'boss@example.com', 'Jordan')$$, :'admin_id'),
  'T2  webhook can provision an allowlisted admin');

select test.expect_error(
  format($$select public.provision_profile('%s', 'stranger@evil.com', 'Nobody')$$, :'stranger_id'),
  'T3  ATTACK provision a NON-allowlisted email');

-- Diagnostic check, not an app_pipeline capability test -- runs unrestricted.
-- app_pipeline itself has no direct SELECT grant on profiles (correctly: only
-- provision_profile()'s SECURITY DEFINER context touches that table).
reset role;

select test.expect_count(
  $$select count(*) from public.profiles where is_admin$$, 1,
  'T4  admin flag provisioned from allowlist, not self-declared');

select test.expect_error(
  format($$select public.provision_profile('%s', 'stranger@evil.com', 'Nobody')$$, :'stranger_id'),
  'T5  ATTACK call provision_profile directly as a plain session (no grant)');

-- ====================================================== as a NON-ADMIN user ==
set role authenticated;
set request.jwt.claim.sub = :'owner_id';

select test.expect_error(
  $$update public.profiles set is_admin = true where id = auth.user_id()$$,
  'T6  ATTACK self-elevate to admin');

select test.expect_error(
  $$update public.profiles set espn_team_id = 99 where id = auth.user_id()$$,
  'T7  ATTACK reassign own ESPN team');

select test.expect_rowcount(
  $$update public.profiles set display_name = 'Ryan M.' where id = auth.user_id()$$, 1,
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
    values (auth.user_id(),2026,1,1,6)$$,
  'T11 pick in an OPEN week is allowed');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (auth.user_id(),2026,2,11,1)$$,
  'T12 ATTACK pick in a LOCKED week');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (auth.user_id(),2026,1,2,6)$$,
  'T13 ATTACK pick a team that is not in the matchup');

select test.expect_error(
  format($$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values ('%s',2026,1,2,11)$$, :'admin_id'),
  'T14 ATTACK submit a pick as another user');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (auth.user_id(),2026,99,1,6)$$,
  'T15 ATTACK unknown week (lock helper must fail CLOSED)');

select test.expect_error(
  $$insert into public.prediction_scores (prediction_id,is_correct,points)
    select id,true,100 from public.predictions where user_id = auth.user_id() limit 1$$,
  'T16 ATTACK award yourself prediction points');

-- Seed a locked-week pick as the connecting superuser (unrestricted, bypasses
-- everything unconditionally) purely to set up the fixture -- not standing in
-- for any production role. app_pipeline itself is never granted direct write
-- access to predictions: nothing in the real design needs it, since the
-- pipeline's only write path into this table's orbit is prediction_scores,
-- populated by scoring picks after the fact, never predictions rows themselves.
reset role; reset request.jwt.claim.sub;
set app.allow_locked_writes = 'on';
insert into public.predictions (id,user_id,season,week,espn_matchup_id,predicted_winner_team_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', :'owner_id', 2026,2,11,1);
reset app.allow_locked_writes;
-- A rival's pick in the OPEN week, for the secrecy check.
insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
values (:'admin_id', 2026,1,1,1);

set role authenticated;
set request.jwt.claim.sub = :'owner_id';

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
set request.jwt.claim.sub = :'admin_id';

select test.expect_count(
  $$select count(*) from public.league_allowlist$$, 2,
  'T21 admin CAN read the allowlist');

select test.expect_error(
  format($$update public.profiles set is_admin = true where id = '%s'$$, :'owner_id'),
  'T22 even an admin cannot grant admin via the client');

-- ================================================================== summary ==
reset role; reset request.jwt.claim.sub;

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
