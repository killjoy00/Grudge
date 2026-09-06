-- ------------------------------------------ ESPN projections and the draft
--
-- Both are league-public read and pipeline-only write. The read side matters
-- as much as the write side here: the projection is the one thing on the
-- predictions page that IS visible before kickoff, so a policy that hid it
-- would silently empty the feature rather than break it.

select test.expect_ok(
  $$select count(*) from public.matchup_projections$$,
  'T53 ESPN projections are readable before kickoff');

select test.expect_error(
  $$insert into public.matchup_projections
      (season, week, espn_matchup_id, espn_team_id, projected_points, starters)
    values (2026, 1, 1, 6, 999.9, 10)$$,
  'T54 ATTACK invent an ESPN projection');

select test.expect_error(
  $$update public.matchup_projections set projected_points = 0$$,
  'T55 ATTACK rewrite an ESPN projection after the fact');

select test.expect_ok(
  $$select count(*) from public.draft_picks$$,
  'T56 the draft board is readable');

select test.expect_error(
  $$insert into public.draft_picks
      (season, overall_pick, round, round_pick, espn_team_id, espn_player_id)
    values (2026, 1, 1, 1, 6, 1)$$,
  'T57 ATTACK rewrite the draft board');

select test.expect_ok(
  $$select count(*) from public.legacy_draft_performance$$,
  'T58 legacy draft performance is readable');

select test.expect_error(
  $$insert into public.legacy_draft_performance
      (season, espn_player_id, fantasy_points, source)
    values (2017, 1, 999.9, 'espn_exact')$$,
  'T59 ATTACK invent legacy draft performance');

-- Identity cleared: a pooled connection must not carry the previous request's
-- voter into the next one and hand them the tally.
reset app.user_id;
select test.expect_count(
  $$select count(*) from public.trade_votes where trade_id = 'rls-trade'$$, 0,
  'T52 identity cleared -> the tally is invisible again');

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
