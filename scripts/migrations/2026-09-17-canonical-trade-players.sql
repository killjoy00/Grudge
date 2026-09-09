-- trade_players is derived league history, not raw ESPN ingestion. Give every
-- row a canonical nfl_players.player_key while retaining espn_player_id as
-- source evidence.

begin;

alter table public.trade_players add column if not exists player_key text;

update public.trade_players tp
   set player_key = a.player_key
  from public.nfl_player_aliases a
 where a.season = tp.season
   and a.espn_player_id = tp.espn_player_id
   and tp.player_key is distinct from a.player_key;

do $$
begin
  if exists (select 1 from public.trade_players where player_key is null) then
    raise exception 'trade_players contains rows without canonical player aliases';
  end if;
end $$;

alter table public.trade_players alter column player_key set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='trade_players_player_key_fkey') then
    alter table public.trade_players add constraint trade_players_player_key_fkey
      foreign key(player_key) references public.nfl_players(player_key);
  end if;
end $$;

create unique index if not exists trade_players_trade_player_key
  on public.trade_players(season,trade_id,player_key);

comment on column public.trade_players.player_key is
  'Canonical nfl_players identity. espn_player_id is retained only as source evidence.';

commit;
