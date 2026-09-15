import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectTrades, type OwnershipRow } from './trade-history.ts';
import { rehydrateLedgerTransactions } from './reconcile-live-trades.ts';

test('persisted draft ownership and an empty accept shell recover the 2026 preseason trade', () => {
  const acceptedAt = '2026-09-01T22:19:16.547Z';
  const transactions = rehydrateLedgerTransactions([
    { id: 'draft-waddle', type: 'DRAFT', status: 'EXECUTED', week: 1, team_id: 9, proposed_at: '2026-08-30T01:39:33.696Z', related_transaction_id: null },
    { id: 'draft-egbuka', type: 'DRAFT', status: 'EXECUTED', week: 1, team_id: 4, proposed_at: '2026-08-30T01:39:33.696Z', related_transaction_id: null },
    { id: 'draft-irving', type: 'DRAFT', status: 'EXECUTED', week: 1, team_id: 4, proposed_at: '2026-08-30T01:39:33.696Z', related_transaction_id: null },
    { id: 'draft-loveland', type: 'DRAFT', status: 'EXECUTED', week: 1, team_id: 9, proposed_at: '2026-08-30T01:39:33.696Z', related_transaction_id: null },
    { id: 'accept', type: 'TRADE_ACCEPT', status: null, week: 1, team_id: 9, proposed_at: acceptedAt, related_transaction_id: 'proposal' },
  ], [
    { espn_transaction_id: 'draft-waddle', item_type: 'DRAFT', espn_player_id: '4372016', from_team_id: 0, to_team_id: 9 },
    { espn_transaction_id: 'draft-egbuka', item_type: 'DRAFT', espn_player_id: '4567750', from_team_id: 0, to_team_id: 4 },
    { espn_transaction_id: 'draft-irving', item_type: 'DRAFT', espn_player_id: '4596448', from_team_id: 0, to_team_id: 4 },
    { espn_transaction_id: 'draft-loveland', item_type: 'DRAFT', espn_player_id: '4723086', from_team_id: 0, to_team_id: 9 },
  ]);

  const ownership: OwnershipRow[] = [
    { week: 1, espn_team_id: 4, espn_player_id: 4372016 },
    { week: 1, espn_team_id: 9, espn_player_id: 4567750 },
    { week: 1, espn_team_id: 9, espn_player_id: 4596448 },
    { week: 1, espn_team_id: 4, espn_player_id: 4723086 },
  ];

  const trades = detectTrades(2026, ownership, transactions);
  assert.equal(trades.length, 1);
  const trade = trades[0]!;
  assert.deepEqual([trade.team_a, trade.team_b], [4, 9]);
  assert.equal(trade.confidence, 'reciprocal');
  assert.equal(trade.espn_transaction_id, 'accept');
  assert.equal(trade.accepted_at, acceptedAt);
  assert.deepEqual(
    trade.players.map((player) => [player.espn_player_id, player.from_team_id, player.to_team_id]),
    [
      [4372016, 9, 4],
      [4567750, 4, 9],
      [4596448, 4, 9],
      [4723086, 9, 4],
    ],
  );
});
