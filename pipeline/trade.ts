/**
 * Trade valuation: positional scarcity, not projected points.
 *
 * WHY NOT PROJECTIONS. ESPN's projections are visible to all ten managers in
 * ESPN's own UI. A tool that ranks by them tells you what everyone already
 * sees, while wearing the authority of a model -- which is how you lose a
 * trade. Everything here is built from points actually scored under THIS
 * league's scoring rules (23 of its 40 scoring items carry position-specific
 * pointsOverrides, so generic value is measurably wrong here).
 *
 * THE MODEL, in one line: a player is worth what he scores ABOVE the player
 * you would otherwise have to start at his position.
 *
 * A 12 ppg RB2 is worth a lot when your alternative is 6, and nearly nothing
 * when your alternative is 11. That difference is invisible to any ranking of
 * raw points, and it is the entire reason trades happen.
 *
 * FOUR STAGES:
 *   1. Starter demand per position, measured from how slots were ACTUALLY
 *      filled in this league (not assumed from slot names).
 *   2. Replacement level: the ppg of the first player at each position beyond
 *      that demand.
 *   3. Player value: ppg minus his position's replacement level.
 *   4. Trade verdict: the change in each side's EXACT best starting lineup,
 *      not the sum of player values -- see evaluateTrade for why.
 */
import { bestLineup, expandSlots, type LineupPlayer } from './lineup.ts';

/** ESPN position ids, confirmed in Step 1 by inverting eligibleSlots. */
export const POSITIONS: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST',
};

export interface PlayerSeason {
  playerId: number;
  name: string;
  positionId: number;
  /** Lineup slots this player may fill, from his own eligibleSlots. */
  eligible: number[];
  /** Points per game in games he was rostered. */
  ppg: number;
  /** How many games that average is built from -- small samples are shrunk. */
  games: number;
}

/* ------------------------------------------------------------ stage 1 & 2 */

/**
 * How many starters of each position the league actually demands per week.
 *
 * Dedicated slots are simple arithmetic. Multi-position slots (this league has
 * a WR/TE and a RB/WR/TE FLEX) are NOT split evenly or by guesswork -- they are
 * apportioned by how those slots were really filled across every archived
 * week. Measured over 7 seasons: the WR/TE slot ran 93.5% WR, and the FLEX ran
 * 66.8% RB / 30.9% WR / 2.3% TE.
 *
 * Guessing here would move every replacement level, and therefore every trade
 * verdict, so it is derived rather than assumed.
 */
export function starterDemand(
  slotCapacity: Map<number, number>,
  slotEligiblePositions: Map<number, number[]>,
  observedFill: Map<number, Map<number, number>>,
  teams: number
): Map<number, number> {
  const demand = new Map<number, number>();
  const add = (pos: number, n: number) => demand.set(pos, (demand.get(pos) ?? 0) + n);

  for (const [slot, capacity] of slotCapacity) {
    const positions = slotEligiblePositions.get(slot) ?? [];
    const openings = capacity * teams;
    if (positions.length === 0) continue;

    if (positions.length === 1) {
      add(positions[0]!, openings);
      continue;
    }

    const fill = observedFill.get(slot);
    const total = fill ? [...fill.values()].reduce((a, b) => a + b, 0) : 0;
    if (!fill || total === 0) {
      // No observations yet (a brand-new league, or a slot never used). Split
      // evenly and let it be visibly crude rather than silently inventing a
      // split that looks measured.
      for (const p of positions) add(p, openings / positions.length);
      continue;
    }
    for (const p of positions) add(p, openings * ((fill.get(p) ?? 0) / total));
  }
  return demand;
}

/**
 * Replacement level per position: the ppg of the best player you would NOT
 * already be starting somewhere in the league.
 *
 * Concretely, sort a position by ppg and read off the player at rank
 * ceil(demand). With 10 teams starting ~26.7 RBs a week, replacement is roughly
 * the 27th-best RB -- that is what you can actually get your hands on.
 *
 * RANKED BY SHRUNK PPG, NOT RAW. This is not a refinement; the first version
 * ranked on raw ppg and was visibly wrong. In 2025 it called Emanuel Wilson the
 * best RB in the league on the strength of 25.50 points in a single game,
 * ahead of Christian McCaffrey, who actually led the position with 356.9 points
 * across 17. 36 of 265 rostered players had two games or fewer, and those
 * one-week wonders were setting the replacement level for everyone.
 *
 * Shrinking first requires a replacement level to shrink toward, which is
 * circular, so this iterates to a fixed point: rank raw, take a level, re-rank
 * shrunk, repeat. It converges in two or three passes because the level only
 * has to be roughly right for the ordering to settle.
 *
 * Positions with fewer rostered players than demand fall back to the worst
 * observed player rather than zero. Zero would price the last man at a position
 * as infinitely valuable, which is how a scarcity model produces absurd advice.
 */
export function replacementLevels(
  players: PlayerSeason[],
  demand: Map<number, number>,
  prior = 4
): Map<number, number> {
  const byPos = new Map<number, PlayerSeason[]>();
  for (const p of players) {
    const list = byPos.get(p.positionId) ?? [];
    list.push(p);
    byPos.set(p.positionId, list);
  }

  const levels = new Map<number, number>();
  const levelFor = (list: PlayerSeason[], pos: number, score: (p: PlayerSeason) => number) => {
    const sorted = [...list].sort((a, b) => score(b) - score(a));
    const need = Math.ceil(demand.get(pos) ?? 0);
    const idx = Math.min(Math.max(need, 0), sorted.length - 1);
    const at = sorted[idx] ?? sorted[sorted.length - 1];
    return at ? score(at) : 0;
  };

  // Pass 0: raw, purely to get something to shrink toward.
  for (const [pos, list] of byPos) levels.set(pos, levelFor(list, pos, (p) => p.ppg));

  // Passes 1..3: re-rank on shrunk values and re-read the level.
  for (let iter = 0; iter < 3; iter++) {
    for (const [pos, list] of byPos) {
      const current = levels.get(pos) ?? 0;
      levels.set(pos, levelFor(list, pos, (p) => shrunkPpg(p, current, prior)));
    }
  }
  return levels;
}

/**
 * Shrink a small-sample average toward the position's replacement level.
 *
 * A player with two big games is not a star, and in a 14-week season that
 * distinction decides trades. `prior` is how many games of evidence it takes
 * before the raw average is trusted at half weight.
 *
 * The direction matters: shrinking toward REPLACEMENT rather than toward the
 * positional mean means an unproven player is treated as ordinary, not as
 * average-good. Trade advice should not be excited by a two-week hot streak.
 */
export function shrunkPpg(p: PlayerSeason, replacement: number, prior = 4): number {
  if (p.games <= 0) return replacement;
  const w = p.games / (p.games + prior);
  return w * p.ppg + (1 - w) * replacement;
}

/** Value over replacement, in points per game. */
export function valueOverReplacement(
  p: PlayerSeason,
  levels: Map<number, number>,
  prior = 4
): number {
  const replacement = levels.get(p.positionId) ?? 0;
  return shrunkPpg(p, replacement, prior) - replacement;
}

/* ----------------------------------------------------------------- stage 4 */

export interface TradeSide {
  teamId: number;
  roster: PlayerSeason[];
  gives: number[]; // player ids
}

export interface TradeVerdict {
  teamId: number;
  lineupBefore: number;
  lineupAfter: number;
  delta: number;
}

/**
 * Value a roster as the exact best lineup it can field, per week.
 *
 * NOT the sum of its players' values. Summing is the mistake that makes naive
 * trade tools recommend bad trades: it counts your fourth-best WR at full value
 * when he would never start, and it misses that trading your only TE for a
 * better WR can raise total roster value while LOWERING the points you actually
 * put on the field.
 */
export function rosterStrength(
  roster: PlayerSeason[],
  levels: Map<number, number>,
  slots: number[],
  prior = 4
): number {
  const players: LineupPlayer[] = roster.map((p) => ({
    id: p.playerId,
    points: shrunkPpg(p, levels.get(p.positionId) ?? 0, prior),
    eligible: p.eligible,
  }));
  return bestLineup(players, slots).total;
}

/**
 * Evaluate one proposed trade for both sides.
 *
 * Returns each team's change in expected weekly starting points. A trade is
 * only worth surfacing when BOTH deltas are positive -- see findTrades.
 */
export function evaluateTrade(
  a: TradeSide,
  b: TradeSide,
  levels: Map<number, number>,
  slots: number[],
  prior = 4
): { a: TradeVerdict; b: TradeVerdict } {
  const byId = new Map<number, PlayerSeason>();
  for (const p of [...a.roster, ...b.roster]) byId.set(p.playerId, p);

  const swap = (side: TradeSide, incoming: number[]) => {
    const out = new Set(side.gives);
    const kept = side.roster.filter((p) => !out.has(p.playerId));
    const added = incoming.map((id) => byId.get(id)).filter((p): p is PlayerSeason => !!p);
    return [...kept, ...added];
  };

  const aBefore = rosterStrength(a.roster, levels, slots, prior);
  const bBefore = rosterStrength(b.roster, levels, slots, prior);
  const aAfter = rosterStrength(swap(a, b.gives), levels, slots, prior);
  const bAfter = rosterStrength(swap(b, a.gives), levels, slots, prior);

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    a: { teamId: a.teamId, lineupBefore: round(aBefore), lineupAfter: round(aAfter), delta: round(aAfter - aBefore) },
    b: { teamId: b.teamId, lineupBefore: round(bBefore), lineupAfter: round(bAfter), delta: round(bAfter - bBefore) },
  };
}

export interface TradeSuggestion {
  teamA: number;
  teamB: number;
  aGives: { playerId: number; name: string; position: string }[];
  bGives: { playerId: number; name: string; position: string }[];
  aDelta: number;
  bDelta: number;
  /** The smaller of the two gains -- how mutual the trade actually is. */
  fairness: number;
}

/**
 * One-for-one trades that make BOTH rosters better.
 *
 * Only mutual gains are returned. A finder that surfaces one-sided wins is a
 * tool nobody on the other end will ever accept a trade from, so it is worse
 * than useless -- it burns the manager's credibility in the league chat.
 *
 * Both gains being positive is not a paradox: it is the whole point of
 * positional scarcity. A team with three startable RBs and no TE, trading with
 * a team holding two good TEs and a thin backfield, genuinely leaves both
 * lineups stronger. If no such pair exists, the honest answer is an empty list.
 *
 * Deliberately limited to 1-for-1. Multi-player packages explode the search
 * space and, more importantly, are where a small modelling error compounds into
 * confident nonsense.
 */
export function findTrades(
  rosters: Map<number, PlayerSeason[]>,
  levels: Map<number, number>,
  slots: number[],
  opts: { minGain?: number; limit?: number; prior?: number } = {}
): TradeSuggestion[] {
  const minGain = opts.minGain ?? 0.5; // ppg; below this it is noise, not signal
  const limit = opts.limit ?? 20;
  const prior = opts.prior ?? 4;

  const teams = [...rosters.keys()].sort((x, y) => x - y);
  const out: TradeSuggestion[] = [];

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const aId = teams[i]!, bId = teams[j]!;
      const aRoster = rosters.get(aId)!, bRoster = rosters.get(bId)!;

      for (const pa of aRoster) {
        for (const pb of bRoster) {
          // Same-position swaps are almost never mutually beneficial and
          // dominate the output with near-identical pairs.
          if (pa.positionId === pb.positionId) continue;

          const v = evaluateTrade(
            { teamId: aId, roster: aRoster, gives: [pa.playerId] },
            { teamId: bId, roster: bRoster, gives: [pb.playerId] },
            levels, slots, prior
          );
          if (v.a.delta < minGain || v.b.delta < minGain) continue;

          out.push({
            teamA: aId, teamB: bId,
            aGives: [{ playerId: pa.playerId, name: pa.name, position: POSITIONS[pa.positionId] ?? String(pa.positionId) }],
            bGives: [{ playerId: pb.playerId, name: pb.name, position: POSITIONS[pb.positionId] ?? String(pb.positionId) }],
            aDelta: v.a.delta, bDelta: v.b.delta,
            fairness: Math.min(v.a.delta, v.b.delta),
          });
        }
      }
    }
  }

  // Ranked by the SMALLER gain, so the top of the list is the trade the other
  // manager is most likely to say yes to -- not the one that helps you most.
  out.sort((x, y) => y.fairness - x.fairness);
  return out.slice(0, limit);
}
