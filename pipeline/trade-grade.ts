/**
 * Who won a trade.
 *
 * THE METRIC, and why this one.
 *
 * A trade is graded on the points each side's ACQUIRED players actually scored
 * FOR THAT SIDE, from the trade's effective week onward. Three consequences,
 * all of them deliberate:
 *
 *   - Starter points are the headline. A player who scored 200 on your bench
 *     did not win you anything. Total rostered points are shown alongside,
 *     because a bench player you never needed is a different kind of miss than
 *     one you kept benching by mistake.
 *   - "For that side" is literal. If you trade for a player and drop him in
 *     week 8, you get his weeks 1-7 and nothing after; if the other manager
 *     claims him, those points are not yours. That falls out of the weekly
 *     roster snapshots without a special case.
 *   - Points before the trade never count, for either side. The question is
 *     what the trade changed, not who had the better player in August.
 *
 * With two sides the comparison is symmetric: A's net is A's haul minus B's,
 * so the winner is simply whoever's acquired players scored more. That stays
 * true for an uneven trade -- two players for one is fine, because the metric
 * is points, not headcount.
 *
 * Pure. The SQL that gathers the rows lives in lib/trade-history-queries.ts.
 */

/** Points one player produced for the team that acquired him, post-trade. */
export interface AcquiredPoints {
  trade_id: string;
  espn_player_id: number;
  to_team_id: number;
  starter_points: number;
  total_points: number;
  weeks_rostered: number;
}

export interface TradeSide {
  espn_team_id: number;
  starterPoints: number;
  totalPoints: number;
  players: AcquiredPoints[];
}

/**
 * A trade has no perspective of its own, so the verdict does not name a side:
 * `graded` means `winner` holds one, `even` means the two hauls tied exactly,
 * `ungraded` means no week has been played since the trade.
 */
export type TradeVerdict = 'graded' | 'even' | 'ungraded';

export interface GradedTrade {
  trade_id: string;
  a: TradeSide;
  b: TradeSide;
  /** Positive means team A is ahead, in starter points. */
  margin: number;
  /** Null until at least one week has been played since the trade. */
  winner: number | null;
  verdict: TradeVerdict;
  weeksScored: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A trade is a tie only on an exact match; anything else has a winner. */
export function gradeTrade(
  trade: { trade_id: string; team_a: number; team_b: number },
  acquired: AcquiredPoints[]
): GradedTrade {
  const side = (teamId: number): TradeSide => {
    const players = acquired.filter(
      (p) => p.trade_id === trade.trade_id && p.to_team_id === teamId
    );
    return {
      espn_team_id: teamId,
      starterPoints: round1(players.reduce((s, p) => s + p.starter_points, 0)),
      totalPoints: round1(players.reduce((s, p) => s + p.total_points, 0)),
      players,
    };
  };
  const a = side(trade.team_a);
  const b = side(trade.team_b);
  const weeksScored = Math.max(
    0,
    ...[...a.players, ...b.players].map((p) => p.weeks_rostered)
  );

  // No week has been played since the trade yet. Reporting 0-0 as "even" would
  // dress up an absence of evidence as a verdict, so it is its own state.
  if (weeksScored === 0) {
    return { trade_id: trade.trade_id, a, b, margin: 0, winner: null, verdict: 'ungraded', weeksScored: 0 };
  }

  const margin = round1(a.starterPoints - b.starterPoints);
  const winner = margin > 0 ? trade.team_a : margin < 0 ? trade.team_b : null;
  return {
    trade_id: trade.trade_id,
    a, b, margin, winner,
    verdict: margin === 0 ? 'even' : 'graded',
    weeksScored,
  };
}

export interface FranchiseTradeRecord {
  franchiseKey: string;
  name: string;
  trades: number;
  won: number;
  lost: number;
  even: number;
  /** Starter points acquired minus starter points given away, all trades. */
  net: number;
  gained: number;
  lost_points: number;
}

/**
 * All-time trade standing per franchise.
 *
 * Ranked on net starter points rather than win-loss, because two lopsided
 * trades and two coin-flips are not the same record and a 2-2 line would say
 * they were. Ungraded trades are counted in `trades` and contribute nothing to
 * the points, so a manager who just made a trade does not appear to have lost
 * it.
 */
export function franchiseTradeRecords(
  graded: GradedTrade[],
  franchise: (season: number, teamId: number) => { key: string; name: string } | null,
  seasonOf: (tradeId: string) => number
): FranchiseTradeRecord[] {
  const acc = new Map<string, FranchiseTradeRecord>();
  const bump = (key: string, name: string) => {
    let row = acc.get(key);
    if (!row) {
      row = { franchiseKey: key, name, trades: 0, won: 0, lost: 0, even: 0, net: 0, gained: 0, lost_points: 0 };
      acc.set(key, row);
    }
    // Names change; the most recent one wins, and callers pass current names.
    row.name = name;
    return row;
  };

  for (const g of graded) {
    const season = seasonOf(g.trade_id);
    for (const [self, other] of [[g.a, g.b], [g.b, g.a]] as const) {
      const f = franchise(season, self.espn_team_id);
      if (!f) continue;
      const row = bump(f.key, f.name);
      row.trades += 1;
      if (g.verdict === 'ungraded') continue;
      row.gained = round1(row.gained + self.starterPoints);
      row.lost_points = round1(row.lost_points + other.starterPoints);
      row.net = round1(row.net + self.starterPoints - other.starterPoints);
      if (g.winner === null) row.even += 1;
      else if (g.winner === self.espn_team_id) row.won += 1;
      else row.lost += 1;
    }
  }

  return [...acc.values()].sort((x, y) => y.net - x.net || y.won - x.won || x.name.localeCompare(y.name));
}
