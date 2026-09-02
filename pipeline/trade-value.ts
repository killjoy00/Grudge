/**
 * What a trade was actually worth, after the fact.
 *
 * THE QUESTION. Not "who got the better player" -- that is a preseason
 * argument. The question is: how many points did this trade put on, or take
 * off, each side's field for the rest of that season?
 *
 * WHY NOT STARTED POINTS. The first version of this graded a side on the
 * points its acquisitions scored while in the starting lineup. That measures
 * the manager's lineup decisions as much as the trade: acquire a stud, bench
 * him by mistake, and the trade scores zero. It also cannot compare a QB's 300
 * points to a TE's 150, because those numbers mean completely different things.
 *
 * WHY NOT THE SUM OF PLAYER VALUES EITHER. Adding up what each side received
 * is the mistake that makes naive trade tools confident and wrong. It counts
 * your fourth-best RB at full value when he would never start, so it scores a
 * 2-for-4 as a rout for whoever received four bodies. It also misses that
 * trading your only tight end for a better receiver can raise the total value
 * on your roster while LOWERING the points you put on the field.
 *
 * THE MODEL: a counterfactual on the real roster.
 *
 * For every week from the trade forward, take the team's actual roster and
 * compute its best possible starting lineup from what those players really
 * scored that week. Then build the roster they WOULD have had -- the players
 * they received taken back out, the players they gave up put back in -- and
 * compute its best lineup. The difference is what the trade did that week.
 * Sum the weeks.
 *
 * Everything the count asymmetry needs falls out of this and needs no special
 * case:
 *   - Position is adjusted implicitly and exactly. A tight end who fills an
 *     empty TE slot is worth all of his points; a fourth running back is worth
 *     whatever he adds over the third, which is usually nothing.
 *   - 2-for-4 is handled by the lineup, not by a rule of thumb. The two extra
 *     bodies only count in the weeks they would actually have started, which
 *     is what makes them worth something (byes, injuries) but not much.
 *   - Byes and injuries are automatic: a player who scored nothing simply does
 *     not make the best lineup, on either side of the counterfactual.
 *   - The BEST lineup is used, not the one the manager set, so this scores the
 *     trade rather than the manager. Started points are still reported
 *     alongside, because "won the trade and benched him" is its own story.
 *
 * DROPPED PLAYERS, symmetrically. A traded player counts only while the team
 * that acquired him still rosters him. Cut a player you traded for and your
 * counterfactual keeps the player you gave up, which is the punishment it
 * should be. Cut a player you were traded and he stops counting for the other
 * side too -- you cannot lose a trade to a player your rival threw away.
 *
 * WHAT THIS CANNOT DO. It needs weekly rosters and weekly scoring, which the
 * archive has from 2018 on. Trades before that can be recorded and read but
 * not graded, and the page says so rather than printing a number built on
 * nothing.
 *
 * Pure: rows in, verdict out. The SQL is in lib/trade-history-queries.ts.
 */
import { bestLineup, expandSlots, type LineupPlayer } from './lineup.ts';
import { starterDemand, replacementLevels, type PlayerSeason } from './trade.ts';
import { capacityFromStarters } from './trade-assemble.ts';

/** Who was on a roster in a given week. */
export interface RosterWeekRow {
  week: number;
  espn_team_id: number;
  espn_player_id: number;
}

/** What a player scored in a given week, wherever he was rostered. */
export interface PlayerWeekPoints {
  week: number;
  espn_player_id: number;
  points: number;
  /** Whether the team that rostered him actually started him. */
  started: boolean;
}

export interface TradeMove {
  espn_player_id: number;
  from_team_id: number;
  to_team_id: number;
}

export interface TradeValueInput {
  effective_week: number;
  team_a: number;
  team_b: number;
  moves: TradeMove[];
  rosters: RosterWeekRow[];
  points: PlayerWeekPoints[];
  /** Lineup slots each player may fill, from ESPN's own eligibleSlots. */
  eligible: Map<number, number[]>;
  /** One entry per startable slot, e.g. [0,2,2,4,4,6,17,16,23]. */
  slots: number[];
  /** Position id per player, for the value-over-replacement figure. */
  position: Map<number, number>;
  /** Replacement-level points per game, by position id. */
  replacement: Map<number, number>;
  /** Weeks to score, ascending. Callers pass completed weeks only. */
  weeks: number[];
}

export interface SideValue {
  espn_team_id: number;
  /** Points this trade added to the side's best possible lineup. THE number. */
  lineupImpact: number;
  /**
   * Points the acquisitions scored above the player the team would otherwise
   * have started at that position, counted only for the weeks they were in the
   * best lineup. This is the position adjustment stated as a number.
   */
  playerValue: number;
  /** Raw points their acquisitions scored while this team rostered them. */
  rosteredPoints: number;
  /** Of those, the ones the manager actually started. */
  startedPoints: number;
  received: number[];
  gaveUp: number[];
}

export interface TradeValue {
  a: SideValue;
  b: SideValue;
  /** Positive means team A gained more lineup points than team B. */
  margin: number;
  winner: number | null;
  weeksScored: number;
  /** True when both sides came out ahead -- a genuinely good trade. */
  mutual: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The best lineup a set of players could have produced in one week.
 *
 * A player with no scoring row that week is passed in at zero rather than
 * dropped, so both branches of the counterfactual see the same roster size and
 * the solver -- not this function -- decides he does not start.
 */
function weekBest(
  playerIds: Iterable<number>,
  weekPoints: Map<number, number>,
  eligible: Map<number, number[]>,
  slots: number[]
): { total: number; started: Set<number> } {
  const players: LineupPlayer[] = [];
  for (const id of playerIds) {
    const slotsFor = eligible.get(id);
    // No eligibility means we have never seen this player in a lineup payload,
    // so we cannot say where he would have played. Leaving him out is the only
    // honest option; counting him everywhere would inflate every lineup he
    // appears in.
    if (!slotsFor?.length) continue;
    players.push({ id, points: weekPoints.get(id) ?? 0, eligible: slotsFor });
  }
  const result = bestLineup(players, slots);
  return { total: result.total, started: new Set(result.assignment.map((a) => a.playerId)) };
}

/**
 * Value one trade for both sides.
 *
 * Note that the two sides' impacts are NOT mirror images: they are measured
 * against different rosters, so both can gain (each filled a hole) or both can
 * lose (each broke something that was working). That asymmetry is real and is
 * the most interesting thing the model says, so it is reported rather than
 * forced into a single zero-sum number.
 */
export function valueTrade(input: TradeValueInput): TradeValue {
  const { team_a, team_b, moves, eligible, slots, weeks } = input;

  // Roster membership and scoring, indexed by week for the inner loop.
  const rosterBy = new Map<number, Map<number, Set<number>>>();
  for (const r of input.rosters) {
    let byTeam = rosterBy.get(r.week);
    if (!byTeam) rosterBy.set(r.week, (byTeam = new Map()));
    let set = byTeam.get(r.espn_team_id);
    if (!set) byTeam.set(r.espn_team_id, (set = new Set()));
    set.add(r.espn_player_id);
  }
  const pointsBy = new Map<number, Map<number, number>>();
  const startedBy = new Map<number, Set<number>>();
  for (const p of input.points) {
    let week = pointsBy.get(p.week);
    if (!week) pointsBy.set(p.week, (week = new Map()));
    week.set(p.espn_player_id, p.points);
    if (p.started) {
      let set = startedBy.get(p.week);
      if (!set) startedBy.set(p.week, (set = new Set()));
      set.add(p.espn_player_id);
    }
  }

  const scored = weeks.filter((w) => w >= input.effective_week && rosterBy.has(w));

  const sideFor = (teamId: number, otherId: number): SideValue => {
    const received = moves.filter((m) => m.to_team_id === teamId).map((m) => m.espn_player_id);
    const gaveUp = moves.filter((m) => m.to_team_id === otherId).map((m) => m.espn_player_id);

    let lineupImpact = 0;
    let playerValue = 0;
    let rosteredPoints = 0;
    let startedPoints = 0;

    for (const week of scored) {
      const byTeam = rosterBy.get(week)!;
      const mine = byTeam.get(teamId);
      if (!mine) continue; // team not in this week's snapshot at all
      const theirs = byTeam.get(otherId) ?? new Set<number>();
      const weekPoints = pointsBy.get(week) ?? new Map<number, number>();
      const started = startedBy.get(week);

      // The roster they would have had. A received player is taken back out
      // only if he is still here; a player they gave up is put back only while
      // the other side still rosters him -- see the module note on symmetry.
      const counterfactual = new Set(mine);
      for (const id of received) counterfactual.delete(id);
      for (const id of gaveUp) if (theirs.has(id)) counterfactual.add(id);

      const best = weekBest(mine, weekPoints, eligible, slots);
      lineupImpact += best.total - weekBest(counterfactual, weekPoints, eligible, slots).total;

      for (const id of received) {
        if (!mine.has(id)) continue;
        const pts = weekPoints.get(id) ?? 0;
        rosteredPoints += pts;
        if (started?.has(id)) startedPoints += pts;
        // Value over replacement is charged only for the weeks he would
        // actually have been in the lineup. Charging a bench week would make
        // an acquisition who never played score BELOW zero, when the truth is
        // that he was worth nothing -- you can always drop him. Without this
        // the figure regularly contradicts the lineup one sitting beside it.
        if (!best.started.has(id)) continue;
        const pos = input.position.get(id);
        playerValue += pts - (pos === undefined ? 0 : input.replacement.get(pos) ?? 0);
      }
    }

    return {
      espn_team_id: teamId,
      lineupImpact: round1(lineupImpact),
      playerValue: round1(playerValue),
      rosteredPoints: round1(rosteredPoints),
      startedPoints: round1(startedPoints),
      received, gaveUp,
    };
  };

  const a = sideFor(team_a, team_b);
  const b = sideFor(team_b, team_a);
  const margin = round1(a.lineupImpact - b.lineupImpact);
  return {
    a, b, margin,
    winner: scored.length === 0 ? null : margin > 0 ? team_a : margin < 0 ? team_b : null,
    weeksScored: scored.length,
    mutual: scored.length > 0 && a.lineupImpact > 0 && b.lineupImpact > 0,
  };
}

/* --------------------------------------------------------- season context */

/** A roster row as the database stores it, with everything valuation needs. */
export interface SeasonRosterRow {
  week: number;
  espn_team_id: number;
  espn_player_id: number;
  lineup_slot_id: number;
  is_starter: boolean;
  applied_points: number;
}

export interface SeasonPlayerRow {
  espn_player_id: number;
  default_position_id: number | null;
  eligible_slots: number[] | null;
}

export interface SeasonContext {
  eligible: Map<number, number[]>;
  slots: number[];
  position: Map<number, number>;
  replacement: Map<number, number>;
  rosters: RosterWeekRow[];
  points: PlayerWeekPoints[];
  weeks: number[];
}

/**
 * Everything a season's trades are valued against, built once and shared.
 *
 * The lineup shape and the replacement levels come from the SAME functions the
 * forward-looking trade board uses -- slot capacity read off lineups people
 * actually set, positional demand apportioned by how multi-position slots were
 * really filled. One definition of replacement level in the codebase, so the
 * board and the history cannot quietly disagree about what a running back is
 * worth.
 */
export function seasonContext(
  rosterRows: SeasonRosterRow[],
  playerRows: SeasonPlayerRow[],
  teamCount: number
): SeasonContext {
  const eligible = new Map<number, number[]>();
  const position = new Map<number, number>();
  for (const p of playerRows) {
    if (p.eligible_slots?.length) eligible.set(p.espn_player_id, p.eligible_slots);
    if (p.default_position_id !== null) position.set(p.espn_player_id, p.default_position_id);
  }

  const starters = rosterRows.filter((r) => r.is_starter);
  const capacity = capacityFromStarters(starters);
  const slots = expandSlots(capacity);

  // Which positions were seen filling each slot, and how often. This is what
  // tells the model that the FLEX runs about two-thirds running backs in this
  // league without anyone asserting it.
  const slotElig = new Map<number, number[]>();
  const observedFill = new Map<number, Map<number, number>>();
  for (const r of starters) {
    const pos = position.get(r.espn_player_id);
    if (pos === undefined) continue;
    const seen = slotElig.get(r.lineup_slot_id) ?? [];
    if (!seen.includes(pos)) seen.push(pos);
    slotElig.set(r.lineup_slot_id, seen);
    const counts = observedFill.get(r.lineup_slot_id) ?? new Map<number, number>();
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
    observedFill.set(r.lineup_slot_id, counts);
  }

  const totals = new Map<number, { points: number; games: number }>();
  for (const r of rosterRows) {
    const acc = totals.get(r.espn_player_id) ?? { points: 0, games: 0 };
    acc.points += r.applied_points;
    acc.games += 1;
    totals.set(r.espn_player_id, acc);
  }
  const seasons: PlayerSeason[] = [];
  for (const [playerId, acc] of totals) {
    const pos = position.get(playerId);
    if (pos === undefined) continue;
    seasons.push({
      playerId, name: String(playerId), positionId: pos,
      eligible: eligible.get(playerId) ?? [],
      ppg: acc.games > 0 ? acc.points / acc.games : 0,
      games: acc.games,
    });
  }
  const demand = starterDemand(capacity, slotElig, observedFill, teamCount);
  const replacement = replacementLevels(seasons, demand);

  return {
    eligible, slots, position, replacement,
    rosters: rosterRows.map((r) => ({
      week: r.week, espn_team_id: r.espn_team_id, espn_player_id: r.espn_player_id,
    })),
    // Points are per player per week regardless of who rostered him, which is
    // what the counterfactual needs: "what would he have scored for you".
    points: rosterRows.map((r) => ({
      week: r.week, espn_player_id: r.espn_player_id,
      points: r.applied_points, started: r.is_starter,
    })),
    weeks: [...new Set(rosterRows.map((r) => r.week))].sort((a, b) => a - b),
  };
}

/* ------------------------------------------------------- all-time records */

export interface FranchiseTradeRecord {
  franchiseKey: string;
  name: string;
  trades: number;
  won: number;
  lost: number;
  even: number;
  /** Lineup points this franchise gained across every trade it has made. */
  gained: number;
  /** Lineup points its trade partners gained. */
  given: number;
  /** gained minus given. The ranking figure. */
  net: number;
}

/**
 * All-time trade standing per franchise.
 *
 * Ranked on net lineup points rather than a win-loss line, because two
 * lopsided trades and two coin flips are not the same record and 2-2 would say
 * they were. A trade with no week played yet counts in `trades` and contributes
 * nothing to the points, so a manager who traded on Tuesday does not appear to
 * have lost it.
 */
export function franchiseTradeRecords(
  valued: { trade_id: string; value: TradeValue }[],
  franchise: (season: number, teamId: number) => { key: string; name: string } | null,
  seasonOf: (tradeId: string) => number
): FranchiseTradeRecord[] {
  const acc = new Map<string, FranchiseTradeRecord>();

  for (const { trade_id, value } of valued) {
    if (!value) continue;
    const season = seasonOf(trade_id);
    for (const [self, other] of [[value.a, value.b], [value.b, value.a]] as const) {
      const f = franchise(season, self.espn_team_id);
      if (!f) continue;
      let row = acc.get(f.key);
      if (!row) {
        row = { franchiseKey: f.key, name: f.name, trades: 0, won: 0, lost: 0, even: 0,
                gained: 0, given: 0, net: 0 };
        acc.set(f.key, row);
      }
      // Names change; callers pass current ones, so the newest wins.
      row.name = f.name;
      row.trades += 1;
      if (value.weeksScored === 0) continue;
      row.gained = round1(row.gained + self.lineupImpact);
      row.given = round1(row.given + other.lineupImpact);
      row.net = round1(row.net + self.lineupImpact - other.lineupImpact);
      if (value.winner === null) row.even += 1;
      else if (value.winner === self.espn_team_id) row.won += 1;
      else row.lost += 1;
    }
  }

  return [...acc.values()]
    .sort((x, y) => y.net - x.net || y.won - x.won || x.name.localeCompare(y.name));
}
