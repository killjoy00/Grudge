#!/usr/bin/env -S npx tsx
/**
 * Calibrate the playoff-odds model against the seven real seasons.
 *
 *   npx tsx pipeline/calibrate.ts
 *
 * A forecast is CALIBRATED when things it calls 70% likely happen about 70% of
 * the time. Being directionally right is not the same thing: a model that says
 * 99% for every eventual playoff team looks impressive and is still wrong, and
 * on the site it would be actively misleading in November.
 *
 * Scored with the Brier score (mean squared error of the probability, lower is
 * better) plus a calibration table, over every team-week from week 3 to the end
 * of each regular season. The "actual" outcome is whether the team finished in
 * the top `playoffTeamCount` on the league's own seeding rule.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EspnLeague } from './espn.ts';
import { matchupRows } from './normalize.ts';
import { teamWeeks, standings, playoffOdds, type OddsParams } from './features.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString()) as EspnLeague;

function seasons(): number[] {
  const dir = join(ROOT, 'data/history');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => /^\d{4}$/.test(d) && existsSync(join(dir, d, 'league.json.gz')))
    .map(Number)
    .sort();
}

interface Point { predicted: number; actual: 0 | 1 }

function evaluate(params: OddsParams, sims: number): Point[] {
  const points: Point[] = [];
  for (const season of seasons()) {
    const league = readGz(join(ROOT, 'data/history', String(season), 'league.json.gz'));
    league.seasonId ??= season;
    const regular = league.settings?.scheduleSettings.matchupPeriodCount ?? 14;
    const playoffTeams = league.settings?.scheduleSettings.playoffTeamCount ?? 6;
    const matchups = matchupRows(league).filter((m) => m.week <= regular);
    const tw = teamWeeks(matchups);
    if (tw.length === 0) continue; // 2020

    // Ground truth: who actually finished in a playoff seed.
    const finalTable = standings(tw);
    const made = new Set(finalTable.slice(0, playoffTeams).map((s) => s.teamId));

    const weeks = [...new Set(tw.map((r) => r.week))].sort((a, b) => a - b);
    for (const week of weeks) {
      if (week < 3 || week >= regular) continue; // week >= regular is already decided
      const played = tw.filter((r) => r.week <= week);
      const remaining = matchups
        .filter((m) => m.week > week)
        .map((m) => ({ week: m.week, homeTeamId: m.home_team_id, awayTeamId: m.away_team_id }));
      const odds = playoffOdds(played, remaining, playoffTeams, sims, 7000 + season * 100 + week, params);
      for (const o of odds) {
        points.push({ predicted: o.playoffPct, actual: made.has(o.teamId) ? 1 : 0 });
      }
    }
  }
  return points;
}

const brier = (pts: Point[]) =>
  pts.reduce((a, p) => a + (p.predicted - p.actual) ** 2, 0) / Math.max(1, pts.length);

function calibrationTable(pts: Point[]) {
  const buckets = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const rows: string[] = [];
  for (let i = 0; i < buckets.length - 1; i++) {
    const lo = buckets[i]!, hi = buckets[i + 1]!;
    const inBucket = pts.filter((p) => p.predicted >= lo && p.predicted < hi);
    if (inBucket.length === 0) continue;
    const pred = inBucket.reduce((a, p) => a + p.predicted, 0) / inBucket.length;
    const act = inBucket.reduce((a, p) => a + p.actual, 0) / inBucket.length;
    const gap = act - pred;
    rows.push(
      `  ${(lo * 100).toString().padStart(3)}-${(Math.min(hi, 1) * 100).toFixed(0).padStart(3)}%  ` +
      `n=${String(inBucket.length).padStart(4)}  predicted ${(pred * 100).toFixed(1).padStart(5)}%  ` +
      `actual ${(act * 100).toFixed(1).padStart(5)}%  gap ${(gap * 100 >= 0 ? '+' : '')}${(gap * 100).toFixed(1)}`
    );
  }
  return rows.join('\n');
}

/** Mean absolute calibration gap, weighted by bucket size. */
function calibrationError(pts: Point[]): number {
  const buckets = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  let weighted = 0, total = 0;
  for (let i = 0; i < buckets.length - 1; i++) {
    const lo = buckets[i]!, hi = buckets[i + 1]!;
    const b = pts.filter((p) => p.predicted >= lo && p.predicted < hi);
    if (b.length === 0) continue;
    const pred = b.reduce((a, p) => a + p.predicted, 0) / b.length;
    const act = b.reduce((a, p) => a + p.actual, 0) / b.length;
    weighted += Math.abs(act - pred) * b.length;
    total += b.length;
  }
  return total ? weighted / total : 0;
}

function main() {
  const SIMS = 3000;
  const grid: OddsParams[] = [];
  for (const shrinkage of [0, 3, 6, 10, 16]) {
    for (const varianceInflation of [1.0, 1.15, 1.25, 1.4, 1.6]) {
      grid.push({ shrinkage, varianceInflation });
    }
  }

  console.log(`Calibrating against ${seasons().length} archived seasons, ${SIMS} sims per week.\n`);
  console.log('  shrink  infl   Brier   calErr');
  const results = grid.map((params) => {
    const pts = evaluate(params, SIMS);
    const b = brier(pts), c = calibrationError(pts);
    console.log(
      `  ${String(params.shrinkage).padStart(6)}  ${params.varianceInflation.toFixed(2)}  ` +
      `${b.toFixed(4)}  ${c.toFixed(4)}`
    );
    return { params, brier: b, calErr: c, pts };
  });

  // Rank by calibration error first: an honest 70% matters more here than a
  // marginally better Brier score, because these numbers get shown to people.
  results.sort((a, b) => a.calErr - b.calErr || a.brier - b.brier);
  const best = results[0]!;
  const baseline = results.find((r) => r.params.shrinkage === 0 && r.params.varianceInflation === 1.0)!;

  console.log(`\nBaseline (no shrinkage, no inflation): Brier ${baseline.brier.toFixed(4)}, calErr ${baseline.calErr.toFixed(4)}`);
  console.log(baseline ? calibrationTable(baseline.pts) : '');
  console.log(`\nBest: shrinkage=${best.params.shrinkage} varianceInflation=${best.params.varianceInflation}`);
  console.log(`      Brier ${best.brier.toFixed(4)}, calErr ${best.calErr.toFixed(4)}`);
  console.log(calibrationTable(best.pts));
}

main();
