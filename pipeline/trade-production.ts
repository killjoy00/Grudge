import {
  UNGRADED_POSITIONS,
  type PlayerWeekPoints,
  type RosterWeekRow,
  type TradeMove,
} from './trade-value.ts';

export interface TradeProductionInput {
  effective_week: number;
  team_a: number;
  team_b: number;
  moves: TradeMove[];
  rosters: RosterWeekRow[];
  points: PlayerWeekPoints[];
  position: Map<number, number>;
  replacement: Map<number, number>;
  weeks: number[];
}

export interface ProductionSide {
  espn_team_id: number;
  /** Actual points above positional replacement while the acquired players were still owned. */
  value: number;
  /** Number of acquired-player weeks included in value. */
  playerWeeks: number;
  received: number[];
}

export interface TradeProductionValue {
  a: ProductionSide;
  b: ProductionSide;
  margin: number;
  winner: number | null;
  graded: boolean;
}

export interface FranchiseProductionRecord {
  franchiseKey: string;
  name: string;
  trades: number;
  won: number;
  lost: number;
  even: number;
  gained: number;
  given: number;
  net: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A roster-independent companion to the lineup-impact trade grade.
 *
 * Every acquired QB/RB/WR/TE earns his actual weekly points minus the same
 * positional replacement baseline used elsewhere in the trade model. The
 * player counts while the acquiring team still rosters him, whether or not a
 * different player on that roster was even better. That makes this answer
 * "who got the better player production?" rather than "who improved this
 * particular lineup more?".
 */
export function valueTradeProduction(input: TradeProductionInput): TradeProductionValue {
  const rosterBy = new Map<number, Map<number, Set<number>>>();
  for (const row of input.rosters) {
    let teams = rosterBy.get(row.week);
    if (!teams) rosterBy.set(row.week, (teams = new Map()));
    let roster = teams.get(row.espn_team_id);
    if (!roster) teams.set(row.espn_team_id, (roster = new Set()));
    roster.add(row.espn_player_id);
  }

  const pointsBy = new Map<number, Map<number, number>>();
  for (const row of input.points) {
    let week = pointsBy.get(row.week);
    if (!week) pointsBy.set(row.week, (week = new Map()));
    week.set(row.espn_player_id, row.points);
  }

  const moves = input.moves.filter((move) => {
    const pos = input.position.get(move.espn_player_id);
    return pos !== undefined && !UNGRADED_POSITIONS.has(pos);
  });
  const scoredWeeks = input.weeks.filter((week) => week >= input.effective_week && rosterBy.has(week));

  const sideFor = (teamId: number): ProductionSide => {
    const received = moves.filter((move) => move.to_team_id === teamId).map((move) => move.espn_player_id);
    let value = 0;
    let playerWeeks = 0;

    for (const week of scoredWeeks) {
      const roster = rosterBy.get(week)?.get(teamId);
      if (!roster) continue;
      const weekPoints = pointsBy.get(week);

      for (const playerId of received) {
        if (!roster.has(playerId)) continue;
        const pos = input.position.get(playerId);
        if (pos === undefined) continue;
        value += (weekPoints?.get(playerId) ?? 0) - (input.replacement.get(pos) ?? 0);
        playerWeeks += 1;
      }
    }

    return { espn_team_id: teamId, value: round1(value), playerWeeks, received };
  };

  const a = sideFor(input.team_a);
  const b = sideFor(input.team_b);
  const graded = a.playerWeeks + b.playerWeeks > 0;
  const margin = round1(a.value - b.value);

  return {
    a,
    b,
    margin,
    winner: !graded ? null : margin > 0 ? input.team_a : margin < 0 ? input.team_b : null,
    graded,
  };
}

export function franchiseProductionRecords(
  valued: { trade_id: string; value: TradeProductionValue }[],
  franchise: (season: number, teamId: number) => { key: string; name: string } | null,
  seasonOf: (tradeId: string) => number
): FranchiseProductionRecord[] {
  const acc = new Map<string, FranchiseProductionRecord>();

  for (const { trade_id, value } of valued) {
    const season = seasonOf(trade_id);
    for (const [self, other] of [[value.a, value.b], [value.b, value.a]] as const) {
      const f = franchise(season, self.espn_team_id);
      if (!f) continue;
      let row = acc.get(f.key);
      if (!row) {
        row = {
          franchiseKey: f.key, name: f.name, trades: 0,
          won: 0, lost: 0, even: 0, gained: 0, given: 0, net: 0,
        };
        acc.set(f.key, row);
      }
      row.name = f.name;
      row.trades += 1;
      if (!value.graded) continue;
      row.gained = round1(row.gained + self.value);
      row.given = round1(row.given + other.value);
      row.net = round1(row.net + self.value - other.value);
      if (self.value === other.value) row.even += 1;
      else if (self.value > other.value) row.won += 1;
      else row.lost += 1;
    }
  }

  return [...acc.values()].sort((a, b) => b.net - a.net || b.won - a.won || a.name.localeCompare(b.name));
}
