#!/usr/bin/env -S npx tsx
/**
 * Reconcile current-season trades from the evidence we have accumulated across
 * ESPN fetches.
 *
 * ESPN's live transaction view is windowed: by Tuesday after week 1 the league
 * payload can contain only the newest roster moves even though earlier DRAFT
 * and TRADE_ACCEPT records were observed and safely persisted in Postgres.
 * Trade detection therefore cannot rely on only the transactions present in a
 * single fetch. This pass rehydrates the durable transaction ledger plus the
 * completed weekly roster snapshots, then runs the same conservative detector
 * and durable writer used everywhere else.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { connect, runTransaction, type Sql } from './db.ts';
import {
  detectTrades,
  type LedgerItem,
  type LedgerTransaction,
  type OwnershipRow,
} from './trade-history.ts';
import { tradeWriteStatements } from './trade-identity.ts';

interface StoredTransactionRow {
  id: string;
  type: string;
  status: string | null;
  week: number;
  team_id: number | null;
  proposed_at: string | Date | null;
  related_transaction_id: string | null;
}

interface StoredItemRow {
  espn_transaction_id: string;
  item_type: string | null;
  espn_player_id: number | string | null;
  from_team_id: number | null;
  to_team_id: number | null;
}

interface StoredOwnershipRow {
  week: number;
  espn_team_id: number;
  espn_player_id: number | string;
}

type Query = <T>(text: string, params?: unknown[]) => Promise<T[]>;

const numberOrUndefined = (value: number | string | null | undefined) =>
  value == null ? undefined : Number(value);

/** Convert normalized DB rows back into the detector's provider-shaped ledger. */
export function rehydrateLedgerTransactions(
  transactions: StoredTransactionRow[],
  items: StoredItemRow[],
): LedgerTransaction[] {
  const itemsByTransaction = new Map<string, LedgerItem[]>();
  for (const item of items) {
    const list = itemsByTransaction.get(item.espn_transaction_id) ?? [];
    list.push({
      type: item.item_type ?? undefined,
      playerId: numberOrUndefined(item.espn_player_id),
      fromTeamId: numberOrUndefined(item.from_team_id),
      toTeamId: numberOrUndefined(item.to_team_id),
    });
    itemsByTransaction.set(item.espn_transaction_id, list);
  }

  return transactions.map((transaction) => ({
    id: transaction.id,
    type: transaction.type,
    status: transaction.status ?? undefined,
    scoringPeriodId: Number(transaction.week),
    teamId: numberOrUndefined(transaction.team_id),
    proposedDate: transaction.proposed_at == null
      ? undefined
      : new Date(transaction.proposed_at).getTime(),
    relatedTransactionId: transaction.related_transaction_id ?? undefined,
    items: itemsByTransaction.get(transaction.id) ?? [],
  }));
}

function queryClient(sql: Sql): Query {
  return (sql as unknown as { query: Query }).query.bind(sql);
}

async function resolveSeason(query: Query, explicit?: number) {
  if (explicit && Number.isInteger(explicit)) return explicit;
  const rows = await query<{ season: number }>(
    `select season from public.seasons where is_current order by season desc limit 1`,
  );
  const season = rows[0]?.season;
  if (!season) throw new Error('No current season is configured');
  return Number(season);
}

export async function reconcileSeasonTrades(sql: Sql, season: number) {
  const query = queryClient(sql);
  const [transactionRows, itemRows, ownershipRows] = await Promise.all([
    query<StoredTransactionRow>(
      `select t.espn_transaction_id as id, t.type, t.status, t.week,
              t.espn_team_id as team_id, t.proposed_at,
              t.raw->>'relatedTransactionId' as related_transaction_id
         from public.transactions t
        where t.season = $1
        order by t.proposed_at nulls first, t.espn_transaction_id`,
      [season],
    ),
    query<StoredItemRow>(
      `select ti.espn_transaction_id, ti.item_type, ti.espn_player_id,
              ti.from_team_id, ti.to_team_id
         from public.transaction_items ti
         join public.transactions t
           on t.espn_transaction_id = ti.espn_transaction_id
        where t.season = $1
        order by ti.espn_transaction_id, ti.item_index`,
      [season],
    ),
    query<StoredOwnershipRow>(
      `select week, espn_team_id, espn_player_id
         from public.roster_entries
        where season = $1
        order by week, espn_team_id, espn_player_id`,
      [season],
    ),
  ]);

  const transactions = rehydrateLedgerTransactions(transactionRows, itemRows);
  const ownership: OwnershipRow[] = ownershipRows.map((row) => ({
    week: Number(row.week),
    espn_team_id: Number(row.espn_team_id),
    espn_player_id: Number(row.espn_player_id),
  }));
  const trades = detectTrades(season, ownership, transactions);
  await runTransaction(sql, tradeWriteStatements(season, trades));
  return { trades, transactions: transactions.length, ownership: ownership.length };
}

async function main() {
  const explicit = process.argv.find((arg) => arg.startsWith('--season='))?.split('=')[1];
  const sql = connect();
  const query = queryClient(sql);
  const season = await resolveSeason(query, explicit ? Number(explicit) : undefined);
  const result = await reconcileSeasonTrades(sql, season);
  console.log(
    `${season}: reconciled ${result.trades.length} trade(s) from ` +
    `${result.transactions} persisted transaction(s) and ${result.ownership} roster row(s)`,
  );
  for (const trade of result.trades) {
    console.log(
      `  ${trade.trade_id}: teams ${trade.team_a}/${trade.team_b}, ` +
      `${trade.players.length} player(s), ${trade.confidence}`,
    );
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
