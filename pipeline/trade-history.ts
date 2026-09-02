/**
 * Reconstruct trades from weekly roster snapshots.
 *
 * ESPN will not tell us what was in a trade. The TRADE_ACCEPT envelope carries
 * an empty `items` array and a `relatedTransactionId` pointing at a proposal
 * that no view returns; the communication endpoint needs cookies the weekly
 * pipeline deliberately does not have. So the contents are inferred.
 *
 * THE INFERENCE, and why it is safe:
 *
 *   A player on team A in one weekly snapshot and on team B in the next, with
 *   no ADD or DROP transaction covering him in between, was traded.
 *
 * The premise is that the add/drop ledger is complete -- that free-agent
 * movement is fully explained by transactions, so an unexplained move must be
 * a trade. That was not assumed. Replaying every DRAFT, WAIVER and ROSTER item
 * over the live 2026 league reproduced all ten current rosters exactly, 161
 * players, zero discrepancies. The ledger is complete; the residue is trades.
 *
 * Pure by design: rows in, trades out. The database round trip lives in the
 * pipeline and the reads in lib/, so the part with the reasoning in it is the
 * part a test can reach.
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
}

/** A transaction envelope, as ESPN sends it. */
export interface LedgerTransaction {
  id: string;
  type: string;
  status?: string;
  scoringPeriodId: number;
  teamId?: number;
  proposedDate?: number;
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
 * `ledger` -- every free-agent move in the window is accounted for by a
 * transaction, so an unexplained change of teams can only be a trade. This is
 * the strong case and it finds one-sided deals too (a player for nothing, a
 * player for FAAB).
 *
 * `reciprocal` -- no transactions survive for that season, so waiver churn and
 * trades look identical one player at a time. Only a genuine SWAP is claimed:
 * both teams received someone in the same window. Two managers each dropping a
 * player and each claiming the other's off waivers in the same week would be
 * caught wrongly, which has never plausibly happened; a one-sided historical
 * trade, by contrast, is simply invisible. The page says which is which.
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
 * Without it a preseason trade is invisible: there is no earlier snapshot to
 * diff week 1 against, so the players would simply appear on their new rosters
 * with nothing to compare. The draft IS that earlier snapshot, and it is the
 * only ownership record that exists before the first week is played.
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
function itemTeam(item: LedgerItem & { toTeamId?: number }, t: LedgerTransaction): number | null {
  const to = item.toTeamId ?? t.teamId ?? null;
  // ESPN uses 0 for "the free agent pool", which is not a team.
  return to && to > 0 ? to : null;
}

const chronological = (t: LedgerTransaction[]) =>
  [...t].sort((a, b) => (a.proposedDate ?? 0) - (b.proposedDate ?? 0));

/**
 * Detect trades for one season.
 *
 * `entries` may contain every column of roster_entries; only the three read
 * here matter. Weeks need not be contiguous -- a missing week just widens the
 * window a move is attributed to, which is the honest answer when that is all
 * the data says.
 */
export function detectTrades(
  season: number,
  entries: OwnershipRow[],
  transactions: LedgerTransaction[]
): DetectedTrade[] {
  const byWeek = new Map<number, Map<number, number>>();
  for (const e of entries) {
    let week = byWeek.get(e.week);
    if (!week) byWeek.set(e.week, (week = new Map()));
    week.set(e.espn_player_id, e.espn_team_id);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  if (weeks.length === 0) return [];

  // Which players had a free-agent transaction in each scoring period. Any
  // move that one of these explains is not a trade.
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

  const accepts = chronological(transactions).filter((t) => t.type === 'TRADE_ACCEPT');
  const usedAccepts = new Set<string>();
  const trades: DetectedTrade[] = [];

  // The ledger licenses the looser rule, so its presence -- not a caller's
  // flag -- decides which rule applies. Seasons 2018-2025 reached the archive
  // with no transactions at all; asking those for one-way moves would report
  // every waiver claim in league history as a trade.
  const confidence: TradeConfidence = transactions.length > 0 ? 'ledger' : 'reciprocal';

  let prev = draftOwnership(transactions);
  let prevWeek = 0;
  for (const week of weeks) {
    const current = byWeek.get(week)!;
    // Free-agent movement that could explain a change between these two
    // snapshots. The range starts at the PREVIOUS week, not the one after it:
    // a claim stamped period W that ESPN processes after week W's snapshot
    // shows up as a move into week W+1, and excluding period W would read that
    // waiver pickup as a trade. Erring wide can at worst suppress a real trade
    // in the same window; erring narrow invents one, which is far worse.
    const churnedBetween = (id: number) => {
      for (let w = prevWeek; w <= week; w++) if (churn.get(w)?.has(id)) return true;
      return false;
    };

    // Group unexplained moves by the unordered pair of teams involved. Two
    // teams that swapped players in the same window made one trade; if they
    // truly made two in that window the snapshots cannot tell them apart, and
    // merging them is the honest reading rather than a guess at the split.
    const pairs = new Map<string, DetectedTradePlayer[]>();
    for (const [playerId, to] of current) {
      const from = prev.get(playerId);
      if (from === undefined || from === to) continue;
      if (churnedBetween(playerId)) continue;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const list = pairs.get(key) ?? [];
      list.push({ espn_player_id: playerId, from_team_id: from, to_team_id: to });
      pairs.set(key, list);
    }

    for (const [key, players] of [...pairs].sort()) {
      const [a, b] = key.split(':').map(Number) as [number, number];
      // Without a ledger, only a two-way swap is safe to call a trade.
      if (confidence === 'reciprocal'
          && !(players.some((p) => p.to_team_id === a) && players.some((p) => p.to_team_id === b))) {
        continue;
      }
      // The envelope is corroboration, not evidence. Take one only when
      // exactly one unused accept sits in this window and names one of the two
      // teams -- anything looser would attach the wrong trade to the wrong
      // players and read as authoritative.
      const candidates = accepts.filter(
        (t) => !usedAccepts.has(t.id)
          && t.scoringPeriodId > prevWeek && t.scoringPeriodId <= week
          && (t.teamId === a || t.teamId === b)
      );
      const accept = candidates.length === 1 ? candidates[0]! : null;
      if (accept) usedAccepts.add(accept.id);

      players.sort((x, y) => x.espn_player_id - y.espn_player_id);
      trades.push({
        season,
        trade_id: `${season}-w${week}-${a}v${b}`,
        effective_week: week,
        team_a: a,
        team_b: b,
        espn_transaction_id: accept?.id ?? null,
        accepted_at: accept?.proposedDate ? new Date(accept.proposedDate).toISOString() : null,
        confidence,
        players,
      });
    }

    prev = current;
    prevWeek = week;
  }

  return trades;
}
