/** Shared, server-independent filters, query contracts and display definitions. */
export const PLAYER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const;
export type PlayerPosition = typeof PLAYER_POSITIONS[number];
export const PLAYER_STATS = [
  ['passing_yards', 'Pass yards'], ['passing_tds', 'Pass TD'], ['passing_interceptions', 'INT'],
  ['carries', 'Carries'], ['rushing_yards', 'Rush yards'], ['rushing_tds', 'Rush TD'],
  ['targets', 'Targets'], ['receptions', 'Rec'], ['receiving_yards', 'Rec yards'], ['receiving_tds', 'Rec TD'],
  ['fumbles_lost_total', 'Fumbles lost'], ['fg_made', 'FG made'], ['fg_att', 'FG att'], ['pat_made', 'XP made'],
  ['def_sacks', 'Sacks'], ['def_interceptions', 'Def INT'], ['def_fumbles', 'Fumbles recovered'],
  ['def_points_allowed', 'Points allowed'], ['def_safeties', 'Safeties'],
  ['passing_td_40', '40+ pass TD'], ['rushing_td_40', '40+ rush TD'], ['receiving_td_40', '40+ rec TD'],
  ['kickoff_return_tds', 'Kick return TD'], ['punt_return_tds', 'Punt return TD'],
  ['interception_return_tds', 'INT return TD'], ['fumble_return_tds', 'Fumble return TD'],
] as const;
export type StatKey = typeof PLAYER_STATS[number][0];
export const SORT_OPTIONS = [
  ['points', 'Fantasy points'], ['average', 'Points / game with stats'], ['full_name', 'Name'],
  ...PLAYER_STATS.slice(0, 18),
] as const;
export type PlayerFilters = {
  season: number; position: string; period: 'REG' | 'POST'; from: number; to: number;
  q: string; sort: string; direction: 'asc' | 'desc'; page: number;
};
type Params = Record<string, string | string[] | undefined>;
export function currentNflSeason(date = new Date()) {
  return date.getUTCFullYear() - Number(date.getUTCMonth() < 2);
}
export function playerFilters(params: Params, current = currentNflSeason()): PlayerFilters {
  const one = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const integer = (key: string, fallback: number, low: number, high: number) => {
    const value = one(key); const number = /^\d+$/.test(value) ? Number(value) : fallback;
    return Math.max(low, Math.min(high, number));
  };
  const season = integer('season', current, 1999, current);
  const period = one('period') === 'POST' ? 'POST' : 'REG';
  const max = season >= 2021 ? 18 : 17;
  const low = period === 'REG' ? 1 : max + 1;
  const high = period === 'REG' ? max : max + 4;
  const start = integer('from', low, low, high);
  const end = integer('to', high, low, high);
  const sort = SORT_OPTIONS.some(([key]) => key === one('sort')) ? one('sort') : 'points';
  return { season, period, from: Math.min(start, end), to: Math.max(start, end),
    position: PLAYER_POSITIONS.includes(one('position') as PlayerPosition) ? one('position') : '',
    q: one('q').trim().slice(0, 80), sort,
    direction: one('direction') === 'asc' || (sort === 'full_name' && !one('direction')) ? 'asc' : 'desc',
    page: integer('page', 1, 1, 1000) };
}
export function playerHref(key: string, season?: number) {
  return `/players/${encodeURIComponent(key)}${season ? `?season=${season}` : ''}`;
}
export function espnPlayerHref(id: number | string, season: number) {
  return `/players/espn/${id}?season=${season}`;
}
export function playerFilterHref(filters: PlayerFilters, changes: Partial<PlayerFilters> = {}) {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams(Object.entries(next).filter(([, v]) => v !== '').map(([k, v]) => [k, String(v)]));
  return `/players?${params}`;
}
export function statColumns(position: string): StatKey[] {
  if (!position) return ['passing_yards', 'rushing_yards', 'receiving_yards', 'receptions'];
  if (position === 'QB') return ['passing_yards', 'passing_tds', 'passing_interceptions', 'rushing_yards', 'rushing_tds'];
  if (position === 'RB') return ['carries', 'rushing_yards', 'rushing_tds', 'targets', 'receptions', 'receiving_yards', 'receiving_tds'];
  if (position === 'K') return ['fg_made', 'fg_att', 'pat_made'];
  if (position === 'D/ST') return ['def_sacks', 'def_interceptions', 'def_fumbles', 'def_points_allowed', 'def_safeties'];
  return ['targets', 'receptions', 'receiving_yards', 'receiving_tds', 'rushing_yards', 'rushing_tds'];
}
export const displayNumber = (value: number | string | null | undefined, digits = 1) =>
  value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export interface PlayerRow extends Partial<Record<StatKey, string | null>> {
  player_key: string; full_name: string; position: string; teams: string[];
  games: number; points: string | null; average: string | null; observed: number; rebuilt: number;
  unavailable: number; total_count: number;
}
export interface PlayerProfile { player_key: string; full_name: string; position: string; bio: Record<string, string | string[]>; }
export interface PlayerGame {
  season: number; week: number; season_type: string; team: string; opponent: string;
  stats: Record<string, number>; fantasy_points: string | null; calculated_points: string | null; score_evidence: string;
}
export interface PlayerImport {
  season: number; row_count: number; status: string; regular_weeks: number[]; postseason_weeks: number[];
  published_at: string; model_version: string; scoring_items: {statId: number; points: number; pointsOverrides?: Record<string, number>}[] | null;
}
export interface PlayerHistoryEvent {
  event_key: string; season: number; week: number | null; end_week: number | null;
  kind: string; team_id: number | null; other_team_id: number | null; detail: string | null;
  occurred_at: string | null; evidence: string;
  team_name: string | null; franchise_key: string | null; managers: string | null;
  other_team_name: string | null; other_managers: string | null;
}
