-- Published draft grades are domain/model output, not raw ESPN evidence.
-- Carry the durable player identity while retaining the ESPN id as provenance.

begin;

alter table public.draft_grade_results add column if not exists player_key text;

update public.draft_grade_results d
   set player_key = a.player_key
  from public.nfl_player_aliases a
 where a.season = d.season
   and a.espn_player_id = d.espn_player_id
   and d.player_key is null;

do $$
declare missing int;
begin
  select count(*) into missing from public.draft_grade_results where player_key is null;
  if missing > 0 then
    raise exception '% draft grade rows do not resolve through season-scoped NFL player aliases', missing;
  end if;
end $$;

alter table public.draft_grade_results alter column player_key set not null;
alter table public.draft_grade_results drop constraint if exists draft_grade_results_player_key_fkey;
alter table public.draft_grade_results add constraint draft_grade_results_player_key_fkey
  foreign key (player_key) references public.nfl_players(player_key);
create index if not exists draft_grade_results_player_idx
  on public.draft_grade_results(season, player_key);

comment on column public.draft_grade_results.player_key is
  'Canonical NFL player identity. Use this for domain joins.';
comment on column public.draft_grade_results.espn_player_id is
  'Season-scoped ESPN source id retained as provenance for the published draft pick.';

commit;
