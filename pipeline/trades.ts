#!/usr/bin/env -S npx tsx
/**
 * Trade partner finder, run against the archives.
 *
 *   npx tsx pipeline/trades.ts                 # current season
 *   npx tsx pipeline/trades.ts --season=2025   # a finished season
 *   npx tsx pipeline/trades.ts --team=6        # only trades involving one team
 *   npx tsx pipeline/trades.ts --min-weeks=4   # refuse below this sample size
 *
 * WHY THIS IS A CLI AND NOT YET A PAGE. The model needs each player's
 * `eligibleSlots`, which lives in the raw ESPN payload and has no column in the
 * `players` table. Adding one is a migration, and migrations run as the
 * pipeline role. Until then this reads the archives directly, which is honest
 * about where the data actually is rather than half-wiring a page that would
 * silently show nothing.
 *
 * The model itself is in trade.ts, with the reasoning for every choice.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rosterEntryRows, starterSlots, starterSlotCounts } from './normalize.ts';
import { expandSlots } from './lineup.ts';
import {
  starterDemand, replacementLevels, findTrades, POSITIONS, type PlayerSeason,
} from './trade.ts';
import type { EspnLeague } from './espn.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

const SEASON = Number(opt('season') ?? new Date().getUTCFullYear());
const TEAM = opt('team') ? Number(opt('team')) : null;
/**
 * Below this many played weeks the model is guessing. Replacement levels come
 * from observed scoring, and three weeks of it is noise -- the model would
 * still produce confident-looking output, which is exactly the failure mode
 * this whole approach exists to avoid.
 */
const MIN_WEEKS = Number(opt('min-weeks') ?? 4);

const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString());

function seasonDir(season: number): string | null {
  for (const base of ['data/history', 'data/seasons']) {
    const d = join(ROOT, base, String(season));
    if (existsSync(join(d, 'league.json.gz'))) return d;
  }
  return null;
}

function main() {
  const dir = seasonDir(SEASON);
  if (!dir) {
    console.error(`no archive for ${SEASON}. Run the pipeline first.`);
    process.exit(1);
  }

  const league = readGz(join(dir, 'league.json.gz')) as EspnLeague;
  league.seasonId ??= SEASON;
  const starters = starterSlots(league);
  const slotCap = starterSlotCounts(league);
  const slots = expandSlots(slotCap);
  const teams = league.settings?.size ?? 10;

  const bxDir = join(dir, 'boxscores');
  if (!existsSync(bxDir)) {
    console.error(`${SEASON} has no boxscores archived; nothing to measure.`);
    process.exit(1);
  }

  // Everything below is derived from the payloads, not assumed: which positions
  // may fill which slot, how those slots were actually filled, and each
  // player's scoring.
  const slotElig = new Map<number, Set<number>>();
  const observedFill = new Map<number, Map<number, number>>();
  const position = new Map<number, number>();
  const eligible = new Map<number, number[]>();
  const name = new Map<number, string>();
  const scoring = new Map<number, { total: number; games: number }>();
  const lastByTeam = new Map<number, Set<number>>();
  let weeksSeen = 0;
  let lastWeek = 0;

  for (const f of readdirSync(bxDir).sort()) {
    const m = /^sp(\d+)\.json\.gz$/.exec(f);
    if (!m?.[1]) continue;
    const week = Number(m[1]);
    const bx = readGz(join(bxDir, f)) as EspnLeague;
    bx.seasonId ??= SEASON;

    for (const mm of bx.schedule ?? []) {
      for (const side of [mm.home, mm.away]) {
        for (const e of side?.rosterForCurrentScoringPeriod?.entries ?? []) {
          const p = e.playerPoolEntry?.player as
            { id: number; fullName?: string; defaultPositionId?: number; eligibleSlots?: number[] } | undefined;
          if (!p || p.defaultPositionId === undefined) continue;
          position.set(p.id, p.defaultPositionId);
          name.set(p.id, p.fullName ?? `player ${p.id}`);
          eligible.set(p.id, p.eligibleSlots ?? []);
          for (const s of p.eligibleSlots ?? []) {
            if (!slotElig.has(s)) slotElig.set(s, new Set());
            slotElig.get(s)!.add(p.defaultPositionId);
          }
        }
      }
    }

    const rows = rosterEntryRows(bx, week, starters);
    if (rows.length === 0) continue;
    weeksSeen++;
    lastWeek = Math.max(lastWeek, week);

    const thisWeek = new Map<number, Set<number>>();
    for (const r of rows) {
      const pos = position.get(r.espn_player_id);
      if (pos === undefined) continue;
      if (r.is_starter) {
        if (!observedFill.has(r.lineup_slot_id)) observedFill.set(r.lineup_slot_id, new Map());
        const f2 = observedFill.get(r.lineup_slot_id)!;
        f2.set(pos, (f2.get(pos) ?? 0) + 1);
      }
      const cur = scoring.get(r.espn_player_id) ?? { total: 0, games: 0 };
      cur.total += r.applied_points ?? 0;
      cur.games += 1;
      scoring.set(r.espn_player_id, cur);

      const set = thisWeek.get(r.espn_team_id) ?? new Set<number>();
      set.add(r.espn_player_id);
      thisWeek.set(r.espn_team_id, set);
    }
    for (const [t, set] of thisWeek) lastByTeam.set(t, set);
  }

  if (weeksSeen < MIN_WEEKS) {
    console.log(`${SEASON}: only ${weeksSeen} played week(s) archived.`);
    console.log(`Replacement levels are measured from actual scoring, and ${weeksSeen} week(s)`);
    console.log(`of it is noise. Refusing to produce trade advice below ${MIN_WEEKS} weeks --`);
    console.log(`the output would look just as confident and mean nothing.`);
    console.log(`\nOverride with --min-weeks=${weeksSeen} if you want to see it anyway.`);
    return;
  }

  const players: PlayerSeason[] = [...scoring].map(([id, v]) => ({
    playerId: id,
    name: name.get(id) ?? `player ${id}`,
    positionId: position.get(id) ?? 0,
    eligible: eligible.get(id) ?? [],
    ppg: v.games > 0 ? v.total / v.games : 0,
    games: v.games,
  }));

  const slotEligArr = new Map([...slotElig].map(([s, v]) => [s, [...v]]));
  const demand = starterDemand(slotCap, slotEligArr, observedFill, teams);
  const levels = replacementLevels(players, demand);

  console.log(`${SEASON}: ${weeksSeen} weeks, ${players.length} rostered players\n`);
  console.log('replacement level (ppg) -- the bar a player must clear to be worth anything:');
  for (const [pid, label] of Object.entries(POSITIONS)) {
    const lvl = levels.get(Number(pid));
    if (lvl === undefined) continue;
    console.log(`  ${label.padEnd(5)} ${lvl.toFixed(2).padStart(6)}   (${(demand.get(Number(pid)) ?? 0).toFixed(1)} started league-wide each week)`);
  }

  const byId = new Map(players.map((p) => [p.playerId, p]));
  const rosters = new Map<number, PlayerSeason[]>();
  for (const [teamId, ids] of lastByTeam) {
    rosters.set(teamId, [...ids].map((id) => byId.get(id)).filter((p): p is PlayerSeason => !!p));
  }

  const found = findTrades(rosters, levels, slots, { limit: 40 })
    .filter((t) => TEAM === null || t.teamA === TEAM || t.teamB === TEAM);

  console.log(`\nrosters as of week ${lastWeek}`);
  console.log(`${found.length} mutually beneficial 1-for-1 trade(s)` +
    (TEAM !== null ? ` involving team ${TEAM}` : '') + '\n');

  if (found.length === 0) {
    console.log('Nothing to suggest. That is a real answer, not a failure --');
    console.log('these rosters have no complementary surplus to swap.');
    return;
  }

  for (const t of found.slice(0, 15)) {
    const g = (x: { name: string; position: string }) => `${x.name} (${x.position})`;
    console.log(`  team ${t.teamA}  sends ${g(t.aGives[0]!)}`);
    console.log(`  team ${t.teamB}  sends ${g(t.bGives[0]!)}`);
    console.log(`     ${String(t.teamA).padStart(2)}: ${t.aDelta > 0 ? '+' : ''}${t.aDelta} ppg` +
                `     ${String(t.teamB).padStart(2)}: ${t.bDelta > 0 ? '+' : ''}${t.bDelta} ppg\n`);
  }

  console.log('Gains are change in expected weekly STARTING points, not player value.');
  console.log('Ranked by the smaller of the two gains, so the most acceptable offer leads.');
}

main();
