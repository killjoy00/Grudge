/**
 * Exact best-possible starting lineup.
 *
 * WHY THIS EXISTS SEPARATELY FROM features.ts optimalLineup(). That one is
 * greedy: it fills the most-constrained slot first and takes the best available
 * player each time. Greedy is fine for the bench-watch feature, where the answer
 * is a talking point and being a few points off changes nothing.
 *
 * Trade evaluation is different. A trade's verdict is the DIFFERENCE between two
 * lineup valuations, so a heuristic that is slightly wrong on each side can flip
 * the sign of a small trade -- and a tool that recommends a bad trade with
 * confidence is worse than no tool. So this solves the assignment exactly.
 *
 * The problem is maximum-weight bipartite matching: 10 starting slots on one
 * side, roster players on the other, an edge wherever a player is eligible for
 * a slot, weighted by points. Solved with the Hungarian algorithm on a padded
 * square matrix. At 10 slots and ~16 players the cubic cost is irrelevant.
 */

export interface LineupPlayer {
  id: number;
  points: number;
  /** Lineup slot ids this player may legally fill, from ESPN's eligibleSlots. */
  eligible: number[];
}

export interface LineupResult {
  total: number;
  /** slot id -> player id, one entry per filled slot. */
  assignment: { slot: number; playerId: number; points: number }[];
}

/** A slot with capacity 2 becomes two independent openings. */
export function expandSlots(slotCapacity: Map<number, number>): number[] {
  const out: number[] = [];
  for (const [slot, n] of slotCapacity) for (let i = 0; i < n; i++) out.push(slot);
  return out;
}

const NEG = -1e9; // stands in for "this player cannot fill this slot"

/**
 * Hungarian algorithm (Jonker-Volgenant style, O(n^3)) minimising total cost.
 * `cost` must be square. Returns, for each row, the column it takes.
 */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const INF = Infinity;
  // 1-indexed potentials and matching, which is what keeps the augmenting-path
  // bookkeeping below readable; index 0 is the sentinel "no column yet".
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0); // column -> row
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) { minv[j] = cur; way[j] = j0; }
        if (minv[j]! < delta) { delta = minv[j]!; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]!]! += delta; v[j]! -= delta; }
        else minv[j]! -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }

  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]! > 0) rowToCol[p[j]! - 1] = j - 1;
  return rowToCol;
}

/**
 * The highest-scoring legal lineup, exactly.
 *
 * Slots that no eligible player can fill are simply left empty rather than
 * forcing an illegal assignment -- a roster with no kicker scores zero from the
 * K slot, which is what actually happens.
 */
export function bestLineup(players: LineupPlayer[], slots: number[]): LineupResult {
  if (slots.length === 0 || players.length === 0) return { total: 0, assignment: [] };

  // Pad to slots + players, NOT max(slots, players). Every slot needs its own
  // "start nobody" column available at cost 0, and padding to the max does not
  // provide one when the counts are equal -- the assignment is then forced.
  //
  // That matters because points can be negative: a D/ST can finish below zero,
  // and ESPN lets a slot stand empty for 0. A forced assignment made the solver
  // start a player who scored -4 instead of leaving the slot open, which is not
  // what an optimal manager does and would have understated every roster
  // carrying a bad defence.
  const n = slots.length + players.length;
  const cost: number[][] = [];
  for (let s = 0; s < n; s++) {
    const row: number[] = [];
    for (let pi = 0; pi < n; pi++) {
      if (s >= slots.length || pi >= players.length) { row.push(0); continue; }
      const player = players[pi]!;
      const slot = slots[s]!;
      // Minimising, so negate points. Ineligible pairs get a large positive
      // cost that the optimum will never choose while any alternative exists.
      row.push(player.eligible.includes(slot) ? -player.points : -NEG);
    }
    cost.push(row);
  }

  const rowToCol = hungarian(cost);
  const assignment: LineupResult['assignment'] = [];
  let total = 0;
  for (let s = 0; s < slots.length; s++) {
    const pi = rowToCol[s];
    if (pi === undefined || pi < 0 || pi >= players.length) continue;
    const player = players[pi]!;
    const slot = slots[s]!;
    // Guard against a padded/ineligible pairing sneaking through when a slot
    // genuinely cannot be filled.
    if (!player.eligible.includes(slot)) continue;
    // A negative-scoring player is never worth starting: the slot scores 0 if
    // left open. The padding above already makes the optimum avoid this, so
    // this is a belt-and-braces guard on the reported assignment.
    if (player.points < 0) continue;
    assignment.push({ slot, playerId: player.id, points: player.points });
    total += player.points;
  }
  return { total, assignment };
}

/**
 * Brute-force reference implementation, for tests only.
 *
 * Exported so the test can assert the fast solver against an obviously-correct
 * one on small inputs. An assignment solver that is subtly wrong would produce
 * plausible trade advice, which is the failure mode worth paying for.
 */
export function bestLineupBruteForce(players: LineupPlayer[], slots: number[]): number {
  const used = new Set<number>();
  const recurse = (slotIndex: number): number => {
    if (slotIndex >= slots.length) return 0;
    const slot = slots[slotIndex]!;
    let best = recurse(slotIndex + 1); // leaving the slot empty is legal
    for (let i = 0; i < players.length; i++) {
      const player = players[i]!;
      if (used.has(i) || !player.eligible.includes(slot)) continue;
      used.add(i);
      best = Math.max(best, player.points + recurse(slotIndex + 1));
      used.delete(i);
    }
    return best;
  };
  return recurse(0);
}
