import { stmt, type Stmt } from './db.ts';
import type { PlayerGame, PlayerProfile } from '../lib/player-data.ts';

export interface PlayerSeasonArtifact {
  schema_version: number; model_version: string; season: number;
  players: {season: number; player_key: string; position: string; teams: string[]}[];
  aliases: {season: number; espn_player_id: number; player_key: string; match_method: string}[];
  rosters: {season: number; espn_team_id: number; player_key: string; snapshot_kind: string}[];
  games: (PlayerGame & {player_key: string; game_id: string})[];
  status: string; regular_weeks: number[]; postseason_weeks: number[];
  scoring_items: unknown; scoring_hash: string | null; validation: unknown; sources: unknown;
}

export function validatePlayerSeason(s: PlayerSeasonArtifact) {
  if (s.schema_version !== 1 || !Number.isInteger(s.season) || s.season < 1999 || !s.players.length)
    throw new Error('Invalid player season artifact');
  if (s.season >= 2005 && (!s.scoring_hash || !Array.isArray(s.scoring_items) || !s.scoring_items.length))
    throw new Error('Missing scoring rules');
  const keys = new Set(s.players.map(p => p.player_key)); const games = new Set<string>();
  if (keys.size !== s.players.length) throw new Error('Duplicate player directory identity');
  if (s.players.some(p => p.season !== s.season) || s.aliases.some(a => a.season !== s.season || !keys.has(a.player_key))
    || new Set(s.aliases.map(a => a.espn_player_id)).size !== s.aliases.length) throw new Error('Invalid season aliases');
  for (const g of s.games) {
    const key = `${g.player_key}:${g.season_type}:${g.week}`;
    if (g.season !== s.season || !keys.has(g.player_key) || games.has(key) || !['REG', 'POST'].includes(g.season_type)
      || !Number.isInteger(g.week) || g.week < 1 || g.week > 25) throw new Error('Invalid or duplicate player game');
    games.add(key);
    if ((g.fantasy_points != null && !Number.isFinite(Number(g.fantasy_points)))
      || (s.season < 2005 && (g.fantasy_points != null || g.calculated_points != null))) throw new Error('Invalid fantasy score');
    if (['observed', 'reconstructed'].includes(g.score_evidence) !== (g.fantasy_points != null)) throw new Error('Invalid scoring evidence');
  }
  const regular = [...new Set(s.games.filter(g => g.season_type === 'REG').map(g => g.week))].sort((a,b)=>a-b);
  if (JSON.stringify(regular) !== JSON.stringify(s.regular_weeks)) throw new Error('Incorrect coverage manifest');
  if (s.status === 'complete' && regular.length !== (s.season >= 2021 ? 18 : 17)) throw new Error('Incomplete regular season');
  if (!s.games.length && s.status !== 'awaiting_games') throw new Error('Unexpected empty season');
}

export function playerRegistryStatements(players: PlayerProfile[]): Stmt[] {
  const statements: Stmt[] = [];
  for (let i = 0; i < players.length; i += 500) statements.push(stmt(`
    insert into public.nfl_players (player_key, full_name, position, bio)
    select player_key, full_name, position, bio from jsonb_to_recordset($1::jsonb)
      as x(player_key text, full_name text, position text, bio jsonb)
    on conflict (player_key) do update set full_name = excluded.full_name, position = excluded.position, bio = excluded.bio
    where (nfl_players.full_name, nfl_players.position, nfl_players.bio) is distinct from
      (excluded.full_name, excluded.position, excluded.bio)`, [JSON.stringify(players.slice(i, i + 500))]));
  return statements;
}

/** One season, including its publication receipt, lands in one transaction. */
export function playerSeasonStatements(s: PlayerSeasonArtifact, hash: string): Stmt[] {
  validatePlayerSeason(s);
  const statements = [stmt(`select pg_advisory_xact_lock(7361, $1)`, [s.season]),
    // A new current roster can change, but a download failure cannot erase games.
    stmt(`select 1 / case when coalesce((select row_count from public.nfl_player_imports where season=$1),0) > $2 * 1.02 then 0 else 1 end`, [s.season, s.games.length]),
    stmt(`insert into public.nfl_player_seasons (season, player_key, position, teams)
      select season, player_key, position, teams from jsonb_to_recordset($1::jsonb)
        as x(season int, player_key text, position text, teams text[])
      on conflict (season, player_key) do update set position=excluded.position, teams=excluded.teams`, [JSON.stringify(s.players)]),
    stmt(`delete from public.nfl_player_games where season = $1`, [s.season])];
  for (let i = 0; i < s.games.length; i += 500) statements.push(stmt(`
    insert into public.nfl_player_games (season, player_key, season_type, week, game_id, team, opponent, stats, fantasy_points, calculated_points, score_evidence)
    select season, player_key, season_type, week, game_id, team, opponent, stats, fantasy_points, calculated_points, score_evidence
    from jsonb_to_recordset($1::jsonb) as x(season int, player_key text, season_type text, week int, game_id text,
      team text, opponent text, stats jsonb, fantasy_points numeric, calculated_points numeric, score_evidence text)`, [JSON.stringify(s.games.slice(i, i + 500))]));
  statements.push(
    stmt(`delete from public.nfl_player_seasons where season=$1 and not (player_key = any($2::text[]))`,
      [s.season, s.players.map(p => p.player_key)]),
    stmt(`delete from public.nfl_player_aliases where season=$1`, [s.season]),
    stmt(`insert into public.nfl_player_aliases (season, espn_player_id, player_key, match_method)
      select season, espn_player_id, player_key, match_method from jsonb_to_recordset($1::jsonb)
      as x(season int, espn_player_id bigint, player_key text, match_method text)`, [JSON.stringify(s.aliases)]),
    stmt(`delete from public.player_archive_rosters where season=$1`, [s.season]),
    stmt(`insert into public.player_archive_rosters (season, espn_team_id, player_key, snapshot_kind)
      select season, espn_team_id, player_key, snapshot_kind from jsonb_to_recordset($1::jsonb)
      as x(season int, espn_team_id int, player_key text, snapshot_kind text)`, [JSON.stringify(s.rosters)]),
    stmt(`insert into public.nfl_player_imports (season, input_hash, model_version, row_count, regular_weeks, postseason_weeks,
      status, scoring_items, scoring_hash, validation, sources)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb)
      on conflict (season) do update set input_hash=excluded.input_hash, model_version=excluded.model_version,
      row_count=excluded.row_count, regular_weeks=excluded.regular_weeks, postseason_weeks=excluded.postseason_weeks,
      status=excluded.status, scoring_items=excluded.scoring_items, scoring_hash=excluded.scoring_hash,
      validation=excluded.validation, sources=excluded.sources, published_at=now()`,
    [s.season, hash, s.model_version, s.games.length, s.regular_weeks, s.postseason_weeks, s.status,
      JSON.stringify(s.scoring_items), s.scoring_hash, JSON.stringify(s.validation), JSON.stringify(s.sources)]));
  return statements;
}


/**
 * Seed canonical identities required by reproducible historical scoring.
 * This is intentionally insert-only: the modern player pipeline may already
 * have a richer name, position, or bio and historical evidence must not erase it.
 */
export function historicalPlayerRegistryStatements(players: PlayerProfile[]): Stmt[] {
  const statements: Stmt[] = [];
  for (let i = 0; i < players.length; i += 500) statements.push(stmt(`
    insert into public.nfl_players (player_key, full_name, position, bio)
    select player_key, full_name, position, bio from jsonb_to_recordset($1::jsonb)
      as x(player_key text, full_name text, position text, bio jsonb)
    on conflict (player_key) do nothing`, [JSON.stringify(players.slice(i, i + 500))]));
  return statements;
}
