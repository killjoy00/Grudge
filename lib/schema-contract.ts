export const SCHEMA_CONTRACT_VERSION = '2026-09-18-canonical-draft-grade-players';

export interface SchemaProbeRow {
  franchise_season_teams: boolean;
  franchise_season_results: boolean;
  manager_franchise_seasons: boolean;
  nfl_players: boolean;
  nfl_player_aliases: boolean;
  player_week_scores: boolean;
  trade_players: boolean;
  draft_grade_results: boolean;
  team_franchise: boolean;
  player_identity: boolean;
  franchise_seasons: boolean;
  score_player_key: boolean;
  trade_player_key: boolean;
  draft_grade_player_key: boolean;
}

export const SCHEMA_PROBE_SQL = `select
  to_regclass('public.franchise_season_teams') is not null as franchise_season_teams,
  to_regclass('public.franchise_season_results') is not null as franchise_season_results,
  to_regclass('public.manager_franchise_seasons') is not null as manager_franchise_seasons,
  to_regclass('public.nfl_players') is not null as nfl_players,
  to_regclass('public.nfl_player_aliases') is not null as nfl_player_aliases,
  to_regclass('public.player_week_scores') is not null as player_week_scores,
  to_regclass('public.trade_players') is not null as trade_players,
  to_regclass('public.draft_grade_results') is not null as draft_grade_results,
  to_regclass('public.team_franchise') is not null as team_franchise,
  to_regclass('public.player_identity') is not null as player_identity,
  to_regclass('public.franchise_seasons') is not null as franchise_seasons,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='player_week_scores' and column_name='player_key') as score_player_key,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='trade_players' and column_name='player_key') as trade_player_key,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='draft_grade_results' and column_name='player_key') as draft_grade_player_key`;

export function schemaProbeOk(row: SchemaProbeRow | null | undefined): boolean {
  return Boolean(row && Object.values(row).every((value) => value === true));
}

export function missingSchemaRequirements(row: SchemaProbeRow | null | undefined): string[] {
  if (!row) return ['schema probe returned no row'];
  return Object.entries(row).filter(([, value]) => value !== true).map(([key]) => key);
}
