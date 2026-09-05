#!/usr/bin/env -S npx tsx
/**
 * Rebuild the score-derived history ESPN still supports before 2018.
 *
 * The recovered legacy archive contains every team score and opponent but no
 * player-level weekly roster entries. That is enough to run the SAME modern
 * standings/luck/power model; it is not enough to reconstruct optimal lineups,
 * bench decisions, player-week records, waiver history or FAAB.
 *
 * This script therefore writes only:
 *   - team_week_results (score/record/all-play fields; lineup fields null)
 *   - luck_index
 *   - power_rankings (MODEL_VERSION / exact current 40/30/20/10 formula)
 *
 * Usage:
 *   npm run history:scores
 *   npm run history:scores -- --from=2005 --to=2017
 *   npm run history:scores -- --dry-run
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EspnLeague } from '../pipeline/espn.ts';
import { matchupRows } from '../pipeline/normalize.ts';
import { luckIndex, MODEL_VERSION, powerRankings, teamWeeks } from '../pipeline/features.ts';
import { connect, runTransaction, upsertChunked, type Stmt } from '../pipeline/db.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY = join(ROOT, 'data', 'history');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const FROM = Number(opt('from', '2005'));
const TO = Number(opt('to', '2017'));
const DRY_RUN = args.includes('--dry-run');

if (!Number.isInteger(FROM) || !Number.isInteger(TO) || FROM > TO) {
  throw new Error(`Invalid season range: ${FROM}-${TO}.`);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface DerivedSeason {
  statements: Stmt[];
  summary: {
    teams: number;
    weeks: number;
    team_week_results: number;
    luck_index: number;
    power_rankings: number;
  };
}

export function buildScoreDerivedSeason(season: number, league: EspnLeague): DerivedSeason {
  league.seasonId ??= season;
  const regular = league.settings?.scheduleSettings.matchupPeriodCount;
  if (!Number.isInteger(regular) || !regular || regular < 1) {
    throw new Error(`${season}: regular-season week count is missing from ESPN settings.`);
  }

  const regularMatchups = matchupRows(league).filter((matchup) => matchup.week <= regular);
  const tw = teamWeeks(regularMatchups);
  if (tw.length === 0) throw new Error(`${season}: no finalized regular-season scores found.`);

  const teams = new Set(tw.map((row) => row.teamId));
  const weeks = [...new Set(tw.map((row) => row.week))].sort((a, b) => a - b);
  const luck = luckIndex(tw);
  const luckByKey = new Map(luck.map((row) => [`${row.week}:${row.teamId}`, row]));
  const statements: Stmt[] = [];

  const cum = new Map<number, { w: number; l: number; t: number; pf: number; pa: number }>();
  const twrRows: Record<string, unknown>[] = [];
  for (const week of weeks) {
    for (const row of tw.filter((candidate) => candidate.week === week)) {
      const current = cum.get(row.teamId) ?? { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
      if (row.result === 'W') current.w += 1;
      else if (row.result === 'L') current.l += 1;
      else current.t += 1;
      current.pf += row.pointsFor;
      current.pa += row.pointsAgainst;
      cum.set(row.teamId, current);
      const lk = luckByKey.get(`${week}:${row.teamId}`);

      twrRows.push({
        season,
        week,
        espn_team_id: row.teamId,
        opponent_team_id: row.opponentId,
        points_for: row.pointsFor,
        points_against: row.pointsAgainst,
        result: row.result,
        optimal_points: null,
        points_left_on_bench: null,
        worst_bench_player_id: null,
        worst_bench_points: null,
        worst_bench_displaced_player_id: null,
        worst_bench_started_points: null,
        league_median: lk?.leagueMedian ?? null,
        beat_median: lk?.beatMedian ?? null,
        all_play_wins: lk?.allPlayWins ?? null,
        all_play_losses: lk?.allPlayLosses ?? null,
        cum_wins: current.w,
        cum_losses: current.l,
        cum_ties: current.t,
        cum_points_for: round2(current.pf),
        cum_points_against: round2(current.pa),
      });
    }
  }
  statements.push(...upsertChunked(
    'public.team_week_results',
    [
      'season', 'week', 'espn_team_id', 'opponent_team_id', 'points_for', 'points_against', 'result',
      'optimal_points', 'points_left_on_bench', 'worst_bench_player_id', 'worst_bench_points',
      'worst_bench_displaced_player_id', 'worst_bench_started_points', 'league_median', 'beat_median',
      'all_play_wins', 'all_play_losses', 'cum_wins', 'cum_losses', 'cum_ties',
      'cum_points_for', 'cum_points_against',
    ],
    twrRows,
    ['season', 'week', 'espn_team_id']
  ));

  const luckRows: Record<string, unknown>[] = [];
  const actualWins = new Map<number, number>();
  const expectedWins = new Map<number, number>();
  for (const week of weeks) {
    for (const row of luck.filter((candidate) => candidate.week === week)) {
      actualWins.set(row.teamId, (actualWins.get(row.teamId) ?? 0) + (row.won ? 1 : 0));
      const opponents = row.allPlayWins + row.allPlayLosses;
      expectedWins.set(
        row.teamId,
        (expectedWins.get(row.teamId) ?? 0) + (opponents ? row.allPlayWins / opponents : 0)
      );
      const actual = actualWins.get(row.teamId) ?? 0;
      const expected = expectedWins.get(row.teamId) ?? 0;
      luckRows.push({
        season,
        week,
        espn_team_id: row.teamId,
        league_median: row.leagueMedian,
        points_for: row.pointsFor,
        expected_wins: round3(expected),
        actual_wins: actual,
        luck_delta: round3(actual - expected),
        week_flag: row.unluckyLoss ? 'UNLUCKY_LOSS' : row.luckyWin ? 'LUCKY_WIN' : null,
        model_version: MODEL_VERSION,
      });
    }
  }
  statements.push(...upsertChunked(
    'public.luck_index',
    [
      'season', 'week', 'espn_team_id', 'league_median', 'points_for', 'expected_wins',
      'actual_wins', 'luck_delta', 'week_flag', 'model_version',
    ],
    luckRows,
    ['season', 'week', 'espn_team_id']
  ));

  const powerRows: Record<string, unknown>[] = [];
  for (const week of weeks) {
    const through = tw.filter((row) => row.week <= week);
    for (const ranking of powerRankings(through, luckIndex(through))) {
      powerRows.push({
        season,
        week,
        espn_team_id: ranking.teamId,
        rank: ranking.rank,
        score: ranking.score,
        components: JSON.stringify(ranking.components),
        model_version: ranking.modelVersion,
      });
    }
  }
  statements.push(...upsertChunked(
    'public.power_rankings',
    ['season', 'week', 'espn_team_id', 'rank', 'score', 'components', 'model_version'],
    powerRows,
    ['season', 'week', 'espn_team_id']
  ));

  return {
    statements,
    summary: {
      teams: teams.size,
      weeks: weeks.length,
      team_week_results: twrRows.length,
      luck_index: luckRows.length,
      power_rankings: powerRows.length,
    },
  };
}

async function main() {
  const sql = DRY_RUN ? null : connect();
  for (let season = FROM; season <= TO; season += 1) {
    const path = join(HISTORY, String(season), 'league.json.gz');
    if (!existsSync(path)) throw new Error(`${season}: missing ${path}.`);
    const league = JSON.parse(gunzipSync(readFileSync(path)).toString()) as EspnLeague;
    const { statements, summary } = buildScoreDerivedSeason(season, league);
    console.log(
      `${season}: ${summary.teams} teams, ${summary.weeks} regular-season weeks, ` +
      `${summary.power_rankings} power rows (${MODEL_VERSION})`
    );
    if (!DRY_RUN && sql) await runTransaction(sql, statements);
  }
  console.log(DRY_RUN ? 'Dry run: database unchanged.' : 'Score-derived history backfill complete.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
