/**
 * Establish trades from ESPN's transaction ledger, with roster snapshots as a
 * deliberately conservative fallback.
 *
 * Historical mTransactions2 captures turned out to contain something the
 * original live-only investigation did not: completed TRADE_ACCEPT /
 * TRADE_UPHOLD envelopes can carry the exact TRADE items, including player,
 * fromTeamId and toTeamId. Those items are authoritative and must win over a
 * weekly roster diff. A player can be traded twice between snapshots; diffing
 * only the endpoints collapses both deals into a fictional third move.
 *
 * When ESPN does NOT preserve itemized completion data, weekly rosters may
 * still recover a trade, but only when the same snapshot window contains
 * player movement in BOTH directions between the same two teams. A one-way
 * ownership change is never enough: it can be a waiver edge case, a player who
 * moved twice inside the window, or one visible half of an unpreserved trade.
 * Omitting an unrecoverable trade is preferable to grading a trade that never
 * happened.
 *
 * Pure by design: rows in, trades out. The database round trip lives in the
 * pipeline and the reads in lib/, so the reasoning stays directly testable.
 */

/** One weekly roster row. Only ownership matters here, not slots or points. */
export interface OwnershipRow {
  week: number;
  espn_team_id: number;
  espn_player_id: number;
}

/** A transaction item, as ESPN sends it. */
export interface LedgerItem {
  type?: string;
  playerId?: number;
  fromTeamId?: number;
  toTeamId?: number;
}

/** A transaction envelope, as ESPN sends it. */
export interface LedgerTransaction {
  id: string;
  type: string;
  status?: string;
  scoringPeriodId: number;
  teamId?: number;
  proposedDate?: number;
  relatedTransactionId?: string;
  items?: LedgerItem[];
}

export interface DetectedTradePlayer {
  espn_player_id: number;
  from_team_id: number;
  to_team_id: number;
}

/**
 * How a trade was established.
 *
 * `ledger` -- ESPN preserved the completed transaction's TRADE items, so the
 * players and both teams come directly from the league ledger.
 *
 * `reciprocal` -- the completed items are unavailable. Weekly roster snapshots
 * show players moving both directions between the same two teams, after known
 * itemized trades are removed. It is useful but explicitly marked as
 * reconstruction.
 */
export type TradeConfidence = 'ledger' | 'reciprocal';

export interface DetectedTrade {
  season: number;
  trade_id: string;
  effective_week: number;
  team_a: number;
  team_b: number;
  espn_transaction_id: string | null;
  accepted_at: string | null;
  confidence: TradeConfidence;
  players: DetectedTradePlayer[];
}

/**
 * The draft is week zero.
 *
 * Without it a preseason trade is invisible to the roster fallback: there is
 * no earlier snapshot to diff week 1 against. Itemized ledger trades do not
 * need this, but keeping draft ownership makes the fallback honest where an
 * older preseason completion lost its items.
 */
function draftOwnership(transactions: LedgerTransaction[]): Map<number, number> {
  const own = new Map<number, number>();
  for (const t of chronological(transactions)) {
    if (t.type !== 'DRAFT') continue;
    if (t.status && t.status !== 'EXECUTED') continue;
    for (const item of t.items ?? []) {
      if (item.playerId === undefined) continue;
      const to = itemTeam(item, t);
      if (to !== null) own.set(item.playerId, to);
    }
  }
  return own;
}

/** Team ids on a DRAFT item live on the envelope, not always on the item. */
function itemTeam(item: LedgerItem, t: LedgerTransaction): number | null {
  const to = item.toTeamId ?? t.teamId ?? null;
  // ESPN uses 0 for "the free agent pool", which is not a team.
  return to && to > 0 ? to : null;
}

const chronological = (t: LedgerTransaction[]) =>
  [...t].sort((a, b) =>
    (a.proposedDate ?? 0) - (b.proposedDate ?? 0) || a.id.localeCompare(b.id));

function tradeMoves(t: LedgerTransaction): DetectedTradePlayer[] {
  const moves: DetectedTradePlayer[] = [];
  for (const item of t.items ?? []) {
    if (item.type !== 'TRADE') continue;
    const playerId = item.playerId;
    const from = item.fromTeamId;
    const to = item.toTeamId;
    if (playerId === undefined || from === undefined || to === undefined) continue;
    if (from <= 0 || to <= 0 || from === to) continue;
    moves.push({ espn_player_id: playerId, from_team_id: from, to_team_id: to });
  }
  return moves.sort((a, b) => a.espn_player_id - b.espn_player_id);
}

/**
 * Only a completed envelope is evidence that the trade actually happened.
 *
 * 2018 stores itemized TRADE_UPHOLD completions; later seasons commonly store
 * itemized EXECUTED TRADE_ACCEPT completions. Pending accepts/proposals are not
 * enough. Exactly two teams and player movement in both directions are required
 * because the current schema and UI model a two-team player trade; if ESPN ever
 * serves a multi-team or pick-only deal, skipping it is safer than flattening it
 * into something the league did not do.
 */
function itemizedCompletion(t: LedgerTransaction): DetectedTradePlayer[] | null {
  const completed = t.status === 'EXECUTED'
    && (t.type === 'TRADE_ACCEPT' || t.type === 'TRADE_UPHOLD');
  if (!completed) return null;
  const moves = tradeMoves(t);
  if (moves.length < 2) return null;
  const teams = [...new Set(moves.flatMap((m) => [m.from_team_id, m.to_team_id]))].sort((a, b) => a - b);
  if (teams.length !== 2) return null;
  const [a, b] = teams as [number, number];
  if (!moves.some((m) => m.from_team_id === a && m.to_team_id === b)) return null;
  if (!moves.some((m) => m.from_team_id === b && m.to_team_id === a)) return null;
  return moves;
}

function allocateTradeId(
  season: number,
  week: number,
  a: number,
  b: number,
  used: Map<string, number>
) {
  const base = `${season}-w${week}-${a}v${b}`;
  const count = (used.get(base) ?? 0) + 1;
  used.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

function pairHasBothDirections(players: DetectedTradePlayer[], a: number, b: number) {
  return players.some((p) => p.from_team_id === a && p.to_team_id === b)
    && players.some((p) => p.from_team_id === b && p.to_team_id === a);
}

/**
 * Detect trades for one season.
 *
 * The authoritative path runs first. The roster fallback then ignores every
 * player explicitly traded in the snapshot window, which is crucial when a
 * player moves twice before the next weekly snapshot: only the ledger can say
 * what the intermediate owner was.
 */
export function detectTrades(
  season: number,
  entries: OwnershipRow[],
  transactions: LedgerTransaction[]
): DetectedTrade[] {
  const usedTradeIds = new Map<string, number>();
  const trades: DetectedTrade[] = [];
  const explicitMovesByPeriod = new Map<number, Set<number>>();
  const explicitTransactionIds = new Set<string>();
  const explicitRelatedIds = new Set<string>();

  // Prefer the real transaction contents whenever ESPN preserved them.
  for (const t of chronological(transactions)) {
    const players = itemizedCompletion(t);
    if (!players) continue;
    const teams = [...new Set(players.flatMap((p) => [p.from_team_id, p.to_team_id]))].sort((a, b) => a - b);
    const [a, b] = teams as [number, number];
    let periodPlayers = explicitMovesByPeriod.get(t.scoringPeriodId);
    if (!periodPlayers) explicitMovesByPeriod.set(t.scoringPeriodId, (periodPlayers = new Set()));
    for (const player of players) periodPlayers.add(player.espn_player_id);
    explicitTransactionIds.add(t.id);
    if (t.relatedTransactionId) explicitRelatedIds.add(t.relatedTransactionId);

    trades.push({
      season,
      trade_id: allocateTradeId(season, t.scoringPeriodId, a, b, usedTradeIds),
      effective_week: t.scoringPeriodId,
      team_a: a,
      team_b: b,
      espn_transaction_id: t.id,
      accepted_at: t.proposedDate ? new Date(t.proposedDate).toISOString() : null,
      confidence: 'ledger',
      players,
    });
  }

  const byWeek = new Map<number, Map<number, number>>();
  for (const e of entries) {
    let week = byWeek.get(e.week);
    if (!week) byWeek.set(e.week, (week = new Map()));
    week.set(e.espn_player_id, e.espn_team_id);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  if (weeks.length === 0) return trades;

  // Free-agent movement is tracked as a warning for the fallback, not as an
  // unconditional exclusion. A player can be added in period W, appear on the
  // W snapshot, then be traded in W+1. Treating any W transaction as an
  // explanation for his later W -> W+1 move hid Jaylen Warren's side of a real
  // 2023 trade. When recent churn touches a reciprocal candidate, an otherwise
  // unambiguous TRADE_ACCEPT is required as corroboration.
  const churn = new Map<number, Set<number>>();
  for (const t of transactions) {
    if (t.status && t.status !== 'EXECUTED') continue;
    for (const item of t.items ?? []) {
      if (item.playerId === undefined) continue;
      if (item.type !== 'ADD' && item.type !== 'DROP') continue;
      let set = churn.get(t.scoringPeriodId);
      if (!set) churn.set(t.scoringPeriodId, (set = new Set()));
      set.add(item.playerId);
    }
  }

  const accepts = chronological(transactions).filter((t) =>
    t.type === 'TRADE_ACCEPT'
    && !explicitTransactionIds.has(t.id)
    && !(t.relatedTransactionId && explicitRelatedIds.has(t.relatedTransactionId))
  );
  const usedAccepts = new Set<string>();

  let prev = draftOwnership(transactions);
  let prevWeek = 0;
  for (const week of weeks) {
    const current = byWeek.get(week)!;
    // A transaction stamped period W can be processed after week W's snapshot
    // and only appear in W+1, so evidence checks include the previous period.
    const inWindow = (index: Map<number, Set<number>>, id: number) => {
      for (let w = prevWeek; w <= week; w++) if (index.get(w)?.has(id)) return true;
      return false;
    };

    // Group endpoint ownership changes by unordered team pair. Known itemized
    // trade players are removed completely: their endpoint move may be the net
    // of multiple real trades and must never be reinterpreted.
    const pairs = new Map<string, DetectedTradePlayer[]>();
    for (const [playerId, to] of current) {
      const from = prev.get(playerId);
      if (from === undefined || from === to) continue;
      if (inWindow(explicitMovesByPeriod, playerId)) continue;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const list = pairs.get(key) ?? [];
      list.push({ espn_player_id: playerId, from_team_id: from, to_team_id: to });
      pairs.set(key, list);
    }

    const reciprocalKeys = [...pairs.entries()]
      .filter(([key, players]) => {
        const [a, b] = key.split(':').map(Number) as [number, number];
        return pairHasBothDirections(players, a, b);
      })
      .map(([key]) => key);

    for (const key of reciprocalKeys.sort()) {
      const players = pairs.get(key)!;
      const [a, b] = key.split(':').map(Number) as [number, number];

      // An empty accept can corroborate a reconstructed pair and its date, but
      // never licenses one-way movement. It is usable only if exactly one
      // candidate accept names either team AND that accept's team participates
      // in exactly one reciprocal pair in this snapshot window.
      const candidates = accepts.filter(
        (t) => !usedAccepts.has(t.id)
          && t.scoringPeriodId >= prevWeek && t.scoringPeriodId <= week
          && (t.teamId === a || t.teamId === b)
      );
      let accept: LedgerTransaction | null = null;
      if (candidates.length === 1) {
        const candidate = candidates[0]!;
        const matchingPairs = reciprocalKeys.filter((pairKey) => {
          const [x, y] = pairKey.split(':').map(Number) as [number, number];
          return candidate.teamId === x || candidate.teamId === y;
        });
        if (matchingPairs.length === 1) accept = candidate;
      }

      const touchedRecentChurn = players.some((p) => inWindow(churn, p.espn_player_id));
      // Cross-waiver claims can theoretically look like a reciprocal swap. If
      // recent ADD/DROP activity touches the candidate, require an actual ESPN
      // trade-accept shell as corroboration before publishing it.
      if (touchedRecentChurn && !accept) continue;
      if (accept) usedAccepts.add(accept.id);

      players.sort((x, y) => x.espn_player_id - y.espn_player_id);
      trades.push({
        season,
        trade_id: allocateTradeId(season, week, a, b, usedTradeIds),
        effective_week: week,
        team_a: a,
        team_b: b,
        espn_transaction_id: accept?.id ?? null,
        accepted_at: accept?.proposedDate ? new Date(accept.proposedDate).toISOString() : null,
        confidence: 'reciprocal',
        players,
      });
    }

    prev = current;
    prevWeek = week;
  }

  return trades.sort((x, y) =>
    x.effective_week - y.effective_week
    || x.team_a - y.team_a
    || x.team_b - y.team_b
    || x.trade_id.localeCompare(y.trade_id));
}
