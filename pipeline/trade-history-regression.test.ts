import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectTrades, type LedgerTransaction, type OwnershipRow } from './trade-history.ts';

const own = (week: number, teamId: number, ...players: number[]): OwnershipRow[] =>
  players.map((espn_player_id) => ({ week, espn_team_id: teamId, espn_player_id }));

test('an accepted reciprocal trade survives a prior-period free-agent acquisition', () => {
  // Mirrors 2023 week 8: player 100 was added to team 4 during period 7,
  // appeared on team 4's week-7 snapshot, then was traded to team 9 for 200.
  // Treating every period-7 ADD as an explanation for the later 4 -> 9 move
  // erases one side of the trade and leaves a fictional one-way deal.
  const entries = [
    ...own(7, 4, 100), ...own(7, 9, 200),
    ...own(8, 4, 200), ...own(8, 9, 100),
  ];
  const transactions: LedgerTransaction[] = [
    {
      id: 'add-100', type: 'FREEAGENT', status: 'EXECUTED', scoringPeriodId: 7,
      teamId: 4, proposedDate: 1,
      items: [{ type: 'ADD', playerId: 100, fromTeamId: 0, toTeamId: 4 }],
    },
    {
      id: 'accept-shell', type: 'TRADE_ACCEPT', scoringPeriodId: 8,
      teamId: 9, proposedDate: 2, relatedTransactionId: 'proposal-missing', items: [],
    },
  ];

  const trades = detectTrades(2023, entries, transactions);
  assert.equal(trades.length, 1);
  assert.equal(trades[0]!.confidence, 'reciprocal');
  assert.equal(trades[0]!.espn_transaction_id, 'accept-shell');
  assert.deepEqual(
    trades[0]!.players.map((p) => [p.espn_player_id, p.from_team_id, p.to_team_id]),
    [[100, 4, 9], [200, 9, 4]]
  );
});
