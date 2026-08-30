-- Attack suite for the RLS model. Each case asserts an outcome and records
-- PASS/FAIL; the file raises at the end if anything failed, so it is usable
-- as a CI gate rather than something a human has to eyeball.
--
-- Two distinct failure shapes are checked, because RLS produces both:
--   * a raised ERROR      (grant denied, or a trigger refusing the write)
--   * a silent 0 ROWS     (policy filtered the row out -- no error at all)
-- Only checking for errors would miss every policy bug of the second kind.

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

grant usage on schema test to authenticated;
grant select, insert on test.results to authenticated;
grant usage, select on sequence test.results_id_seq to authenticated;
grant execute on all functions in schema test to authenticated;

-- =========================================================== signup gating ==
select test.expect_ok(
  $$insert into auth.users (id,email)
    values ('11111111-1111-1111-1111-111111111111','owner@example.com')$$,
  'T1  allowlisted member can sign up');

select test.expect_ok(
  $$insert into auth.users (id,email)
    values ('22222222-2222-2222-2222-222222222222','boss@example.com')$$,
  'T2  allowlisted admin can sign up');

select test.expect_error(
  $$insert into auth.users (id,email)
    values ('33333333-3333-3333-3333-333333333333','stranger@evil.com')$$,
  'T3  NON-allowlisted signup is refused');

select test.expect_count(
  $$select count(*) from public.profiles where is_admin$$, 1,
  'T4  admin flag provisioned from allowlist, not self-declared');

-- ====================================================== as a NON-ADMIN user ==
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select test.expect_error(
  $$update public.profiles set is_admin = true where id = auth.uid()$$,
  'T5  ATTACK self-elevate to admin');

select test.expect_error(
  $$update public.profiles set espn_team_id = 99 where id = auth.uid()$$,
  'T6  ATTACK reassign own ESPN team');

select test.expect_rowcount(
  $$update public.profiles set display_name = 'Ryan' where id = auth.uid()$$, 1,
  'T7  legitimate display_name change works');

select test.expect_rowcount(
  $$update public.profiles set display_name = 'pwned'
     where id = '22222222-2222-2222-2222-222222222222'$$, 0,
  'T8  ATTACK edit another user profile');

select test.expect_count(
  $$select count(*) from public.league_allowlist$$, 0,
  'T9  ATTACK read allowlist (everyone emails) as non-admin');

-- ============================================================= predictions ==
select test.expect_ok(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (auth.uid(),2026,1,1,6)$$,
  'T10 pick in an OPEN week is allowed');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (auth.uid(),2026,2,11,1)$$,
  'T11 ATTACK pick in a LOCKED week');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (auth.uid(),2026,1,2,6)$$,
  'T12 ATTACK pick a team that is not in the matchup');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values ('22222222-2222-2222-2222-222222222222',2026,1,2,11)$$,
  'T13 ATTACK submit a pick as another user');

select test.expect_error(
  $$insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
    values (auth.uid(),2026,99,1,6)$$,
  'T14 ATTACK unknown week (lock helper must fail CLOSED)');

select test.expect_error(
  $$insert into public.prediction_scores (prediction_id,is_correct,points)
    select id,true,100 from public.predictions where user_id = auth.uid() limit 1$$,
  'T15 ATTACK award yourself prediction points');

-- Seed a locked-week pick as the service role, then try to tamper as the user.
reset role; reset request.jwt.claim.sub;
set app.allow_locked_writes = 'on';
insert into public.predictions (id,user_id,season,week,espn_matchup_id,predicted_winner_team_id)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',2026,2,11,1);
reset app.allow_locked_writes;
-- A rival's pick in the OPEN week, for the secrecy check.
insert into public.predictions (user_id,season,week,espn_matchup_id,predicted_winner_team_id)
values ('22222222-2222-2222-2222-222222222222',2026,1,1,1);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select test.expect_rowcount(
  $$update public.predictions set predicted_winner_team_id = 6
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 0,
  'T16 ATTACK change a pick after kickoff');

select test.expect_rowcount(
  $$delete from public.predictions
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 0,
  'T17 ATTACK delete a pick after kickoff');

select test.expect_count(
  $$select count(*) from public.predictions where week = 1$$, 1,
  'T18 pick secrecy: rival OPEN-week picks are hidden');

select test.expect_count(
  $$select count(*) from public.predictions where week = 2$$, 1,
  'T19 locked-week picks become visible to everyone');

-- ========================================================== as an ADMIN user ==
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select test.expect_count(
  $$select count(*) from public.league_allowlist$$, 2,
  'T20 admin CAN read the allowlist');

select test.expect_error(
  $$update public.profiles set is_admin = true
     where id = '11111111-1111-1111-1111-111111111111'$$,
  'T21 even an admin cannot grant admin via the client');

-- ================================================================== summary ==
reset role; reset request.jwt.claim.sub;

select test.expect_count(
  $$select count(*) from public.team_owners where season=2026 and espn_team_id=1$$, 2,
  'T22 co-ownership: two members share one team');

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
