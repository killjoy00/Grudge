import { stmt, type Stmt } from './db.ts';

/**
 * Fill canonical aliases for current-season players that ESPN exposes only in
 * transaction/free-agent ownership data and that therefore never entered the
 * scoring artifact's alias list.
 *
 * This is deliberately conservative: the legacy ESPN cache must already know a
 * non-placeholder name, and that normalized name must identify exactly one row
 * in the canonical NFL registry. Ambiguous or nameless records remain unresolved
 * rather than being guessed.
 */
export function currentSeasonAliasRepairStatement(season: number): Stmt {
  return stmt(`
    with referenced as (
      select ti.espn_player_id
        from public.transaction_items ti
        join public.transactions tr on tr.espn_transaction_id = ti.espn_transaction_id
       where tr.season = $1 and ti.espn_player_id > 0
      union
      select pos.espn_player_id
        from public.player_ownership_snapshots pos
       where pos.season = $1 and pos.espn_player_id > 0
      union
      select d.espn_player_id
        from public.draft_picks d
       where d.season = $1 and d.espn_player_id > 0
      union
      select r.espn_player_id
        from public.roster_entries r
       where r.season = $1 and r.espn_player_id > 0
    ), unresolved as (
      select r.espn_player_id,
             lower(regexp_replace(p.full_name, '[^a-zA-Z0-9]', '', 'g')) as normalized_name
        from referenced r
        join public.players p using (espn_player_id)
        left join public.nfl_player_aliases a
          on a.season = $1 and a.espn_player_id = r.espn_player_id
       where a.espn_player_id is null
         and p.full_name is not null
         and btrim(p.full_name) <> ''
         and p.full_name not like 'ESPN player #%'
    ), unique_matches as (
      select u.espn_player_id, min(np.player_key) as player_key
        from unresolved u
        join public.nfl_players np
          on lower(regexp_replace(np.full_name, '[^a-zA-Z0-9]', '', 'g')) = u.normalized_name
       group by u.espn_player_id
      having count(*) = 1
    )
    insert into public.nfl_player_aliases (season, espn_player_id, player_key, match_method)
    select $1, espn_player_id, player_key, 'legacy_exact_name_unique'
      from unique_matches
    on conflict (season, espn_player_id) do nothing`, [season]);
}
