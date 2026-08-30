#!/usr/bin/env -S npx tsx
/**
 * Step 4 — compute derived features and persist them.
 *
 *   npm run features                  # every archived season
 *   npm run features -- --season=2025
 *   npm run features -- --dry-run
 *
 * Reads the raw archives rather than the database, because optimal-lineup
 * needs each player's `eligibleSlots`, which lives in the raw payload and is
 * deliberately not mirrored into a column. The archives are the source of
 * truth for anything ESPN said; the database holds what we derived from it.
 *
 * Everything for a season is written in ONE transaction, and every write is an
 * upsert keyed on (season, week, team), so re-running recomputes in place.
 * That matters: a model change means re-running every season, and that must be
 * safe to do at any time.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EspnLeague } from './espn.ts';
import { matchupRows, rosterEntryRows, starterSlots, starterSlotCounts } from './normalize.ts';
import {
  teamWeeks, standings, luckIndex, optimalLineup, powerRankings, weeklyAwards,
  playoffOdds, classifyTransaction, MODEL_VERSION,
  type TeamWeek, type OptimalLineup,
} from './features.ts';
import { connect, runTransaction, upsertChunked, type Stmt } from './db.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = args.find((a) => a.startsWith('--season='))?.split('=')[1];

const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString());
const log = (...a: unknown[]) => console.log(...a);

/** Seasons available in either archive location, newest last. */
function archivedSeasons(): { season: number; dir: string }[] {
  const out: { season: number; dir: string }[] = [];
  for (const base of ['history', 'seasons']) {
    const dir = join(DATA, base);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir)) {
      if (!/^\d{4}$/.test(d)) continue;
      if (existsSync(join(dir, d, 'league.json.gz'))) out.push({ season: Number(d), dir: join(dir, d) });
    }
  }
  return out.sort((a, b) => a.season - b.season);
}

interface Loaded {
  league: EspnLeague;
  boxscores: Map<number, EspnLeague>;
  eligible: Map<number, number[]>;
}

function loadSeason(season: number, dir: string): Loaded {
  const league = readGz(join(dir, 'league.json.gz')) as EspnLeague;
  league.seasonId ??= season;
  const boxscores = new Map<number, EspnLeague>();
  const eligible = new Map<number, number[]>();
  const bxDir = join(dir, 'boxscores');
  if (existsSync(bxDir)) {
    for (const f of readdirSync(bxDir)) {
      const m = /^sp(\d+)\.json\.gz$/.exec(f);
      if (!m || !m[1]) continue;
      const bx = readGz(join(bxDir, f)) as EspnLeague;
      bx.seasonId ??= season;
      boxscores.set(Number(m[1]), bx);
      for (const mm of bx.schedule ?? []) {
        for (const side of [mm.home, mm.away]) {
          for (const e of side?.rosterForCurrentScoringPeriod?.entries ?? []) {
            const p = e.playerPoolEntry?.player as { id: number; eligibleSlots?: number[] } | undefined;
            if (p && !eligible.has(p.id)) eligible.set(p.id, p.eligibleSlots ?? []);
          }
        }
      }
    }
  }
  return { league, boxscores, eligible };
}

function buildSeasonStatements(season: number, loaded: Loaded): { statements: Stmt[]; summary: Record<string, number> } {
  const { league, boxscores, eligible } = loaded;
  const statements: Stmt[] = [];
  const summary: Record<string, number> = {};

  const regular = league.settings?.scheduleSettings.matchupPeriodCount ?? 14;
  const playoffTeams = league.settings?.scheduleSettings.playoffTeamCount ?? 6;
  const faabBudget = league.settings?.acquisitionSettings?.acquisitionBudget ?? null;

  const allMatchups = matchupRows(league);
  const regularMatchups = allMatchups.filter((m) => m.week <= regular);
  const tw = teamWeeks(regularMatchups);
  if (tw.length === 0) return { statements, summary };

  const luck = luckIndex(tw);
  const luckByKey = new Map(luck.map((l) => [`${l.week}:${l.teamId}`, l]));
  const weeks = [...new Set(tw.map((r) => r.week))].sort((a, b) => a - b);

  /* ---- optimal lineups, per team-week, from the boxscore archives ---- */
  const starters = starterSlots(league);
  const slotCap = starterSlotCounts(league);
  const lineups: OptimalLineup[] = [];
  for (const [week, bx] of boxscores) {
    if (week > regular) continue;
    const entries = rosterEntryRows(bx, week, starters);
    for (const teamId of new Set(entries.map((e) => e.espn_team_id))) {
      const res = optimalLineup(entries.filter((e) => e.espn_team_id === teamId), eligible, slotCap);
      if (res) lineups.push(res);
    }
  }
  const lineupByKey = new Map(lineups.map((l) => [`${l.week}:${l.teamId}`, l]));

  /* ---- team_week_results, with running totals ---- */
  const cum = new Map<number, { w: number; l: number; t: number; pf: number; pa: number }>();
  const twrRows: Record<string, unknown>[] = [];
  for (const week of weeks) {
    for (const r of tw.filter((x) => x.week === week)) {
      const c = cum.get(r.teamId) ?? { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
      if (r.result === 'W') c.w++;
      else if (r.result === 'L') c.l++;
      else c.t++;
      c.pf += r.pointsFor;
      c.pa += r.pointsAgainst;
      cum.set(r.teamId, c);

      const lk = luckByKey.get(`${week}:${r.teamId}`);
      const ln = lineupByKey.get(`${week}:${r.teamId}`);
      twrRows.push({
        season, week, espn_team_id: r.teamId, opponent_team_id: r.opponentId,
        points_for: r.pointsFor, points_against: r.pointsAgainst, result: r.result,
        optimal_points: ln?.optimalPoints ?? null,
        points_left_on_bench: ln?.pointsLeftOnBench ?? null,
        league_median: lk?.leagueMedian ?? null,
        beat_median: lk?.beatMedian ?? null,
        all_play_wins: lk?.allPlayWins ?? null,
        all_play_losses: lk?.allPlayLosses ?? null,
        cum_wins: c.w, cum_losses: c.l, cum_ties: c.t,
        cum_points_for: round2(c.pf), cum_points_against: round2(c.pa),
      });
    }
  }
  statements.push(...upsertChunked('public.team_week_results',
    ['season', 'week', 'espn_team_id', 'opponent_team_id', 'points_for', 'points_against', 'result',
     'optimal_points', 'points_left_on_bench', 'league_median', 'beat_median',
     'all_play_wins', 'all_play_losses', 'cum_wins', 'cum_losses', 'cum_ties',
     'cum_points_for', 'cum_points_against'],
    twrRows, ['season', 'week', 'espn_team_id']));
  summary.team_week_results = twrRows.length;

  /* ---- luck_index ---- */
  const luckRows: Record<string, unknown>[] = [];
  const actualWins = new Map<number, number>();
  const expWins = new Map<number, number>();
  for (const week of weeks) {
    for (const l of luck.filter((x) => x.week === week)) {
      actualWins.set(l.teamId, (actualWins.get(l.teamId) ?? 0) + (l.won ? 1 : 0));
      const opps = l.allPlayWins + l.allPlayLosses;
      expWins.set(l.teamId, (expWins.get(l.teamId) ?? 0) + (opps ? l.allPlayWins / opps : 0));
      const aw = actualWins.get(l.teamId) ?? 0;
      const ew = expWins.get(l.teamId) ?? 0;
      luckRows.push({
        season, week, espn_team_id: l.teamId,
        league_median: l.leagueMedian, points_for: l.pointsFor,
        expected_wins: round3(ew), actual_wins: aw, luck_delta: round3(aw - ew),
        week_flag: l.unluckyLoss ? 'UNLUCKY_LOSS' : l.luckyWin ? 'LUCKY_WIN' : null,
        model_version: MODEL_VERSION,
      });
    }
  }
  statements.push(...upsertChunked('public.luck_index',
    ['season', 'week', 'espn_team_id', 'league_median', 'points_for', 'expected_wins',
     'actual_wins', 'luck_delta', 'week_flag', 'model_version'],
    luckRows, ['season', 'week', 'espn_team_id']));
  summary.luck_index = luckRows.length;

  /* ---- power rankings, recomputed through each week ---- */
  const prRows: Record<string, unknown>[] = [];
  for (const week of weeks) {
    const through = tw.filter((r) => r.week <= week);
    const pr = powerRankings(through, luckIndex(through));
    for (const r of pr) {
      prRows.push({
        season, week, espn_team_id: r.teamId, rank: r.rank, score: r.score,
        components: JSON.stringify(r.components), model_version: r.modelVersion,
      });
    }
  }
  statements.push(...upsertChunked('public.power_rankings',
    ['season', 'week', 'espn_team_id', 'rank', 'score', 'components', 'model_version'],
    prRows, ['season', 'week', 'espn_team_id']));
  summary.power_rankings = prRows.length;

  /* ---- playoff odds, as of each week, simulating the rest ---- */
  const oddsRows: Record<string, unknown>[] = [];
  for (const week of weeks) {
    const played = tw.filter((r) => r.week <= week);
    const remaining = regularMatchups
      .filter((m) => m.week > week)
      .map((m) => ({ week: m.week, homeTeamId: m.home_team_id, awayTeamId: m.away_team_id }));
    const odds = playoffOdds(played, remaining, playoffTeams, 4000, 20260830 + week);
    for (const o of odds) {
      oddsRows.push({
        season, week, espn_team_id: o.teamId,
        playoff_pct: o.playoffPct, bye_pct: o.byePct, title_pct: null,
        seed_distribution: JSON.stringify(o.seedDistribution),
        sim_count: o.simCount, assumptions: JSON.stringify(o.assumptions),
        model_version: o.modelVersion,
      });
    }
  }
  statements.push(...upsertChunked('public.playoff_odds',
    ['season', 'week', 'espn_team_id', 'playoff_pct', 'bye_pct', 'title_pct',
     'seed_distribution', 'sim_count', 'assumptions', 'model_version'],
    oddsRows, ['season', 'week', 'espn_team_id']));
  summary.playoff_odds = oddsRows.length;

  /* ---- weekly awards ---- */
  const awardRows: Record<string, unknown>[] = [];
  for (const week of weeks) {
    for (const a of weeklyAwards(season, week, tw, regularMatchups, lineups)) {
      awardRows.push({
        season: a.season, week: a.week, award_key: a.awardKey,
        espn_team_id: a.teamId, espn_player_id: null,
        value: a.value, detail: JSON.stringify(a.detail),
      });
    }
  }
  statements.push(...upsertChunked('public.weekly_awards',
    ['season', 'week', 'award_key', 'espn_team_id', 'espn_player_id', 'value', 'detail'],
    awardRows, ['season', 'week', 'award_key']));
  summary.weekly_awards = awardRows.length;

  /* ---- FAAB ledger ---- */
  const faabRows: Record<string, unknown>[] = [];
  if (faabBudget !== null) {
    const spentToDate = new Map<number, number>();
    const espnReported = new Map<number, number>();
    for (const t of league.teams ?? []) espnReported.set(t.id, t.transactionCounter?.acquisitionBudgetSpent ?? 0);
    const teamIds = (league.teams ?? []).map((t) => t.id);

    for (const week of weeks) {
      const weekTxns = (league.transactions ?? []).filter((t) => t.scoringPeriodId === week);
      const spentThisWeek = new Map<number, number>();
      for (const t of weekTxns) {
        const kind = classifyTransaction(t.type, (t.items ?? []).map((i) => i.type ?? ''));
        if (kind !== 'waiver' || t.teamId === undefined) continue;
        spentThisWeek.set(t.teamId, (spentThisWeek.get(t.teamId) ?? 0) + (t.bidAmount ?? 0));
      }
      for (const teamId of teamIds) {
        const wk = spentThisWeek.get(teamId) ?? 0;
        const total = (spentToDate.get(teamId) ?? 0) + wk;
        spentToDate.set(teamId, total);
        faabRows.push({
          season, week, espn_team_id: teamId,
          budget_total: faabBudget, spent_this_week: wk, spent_to_date: total,
          // ESPN's own figure is only meaningful as a season total, so it is
          // attached to the final week; earlier weeks carry null rather than a
          // misleading comparison against a partial ledger.
          espn_reported_spent: week === weeks[weeks.length - 1] ? (espnReported.get(teamId) ?? 0) : null,
        });
      }
    }
  }
  statements.push(...upsertChunked('public.faab_ledger',
    ['season', 'week', 'espn_team_id', 'budget_total', 'spent_this_week', 'spent_to_date', 'espn_reported_spent'],
    faabRows, ['season', 'week', 'espn_team_id']));
  summary.faab_ledger = faabRows.length;

  return { statements, summary };
}

async function main() {
  const seasons = archivedSeasons().filter((s) => !ONLY || String(s.season) === ONLY);
  if (seasons.length === 0) { log('no archived seasons found'); return; }

  for (const { season, dir } of seasons) {
    const loaded = loadSeason(season, dir);
    const { statements, summary } = buildSeasonStatements(season, loaded);
    if (statements.length === 0) {
      log(`${season}: no completed games -- nothing to compute`);
      continue;
    }
    log(`${season}: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    if (DRY_RUN) continue;
    await runTransaction(connect(), statements);
    log(`  committed`);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

main().catch((e) => {
  console.error(`\nfeature computation failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('Nothing was written -- each season is transactional.');
  process.exit(1);
});
