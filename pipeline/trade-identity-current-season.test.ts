import test from 'node:test';
import assert from 'node:assert/strict';

import { modelDatabase, execute } from '../tests/models/database.ts';
import { tradeWriteStatements } from './trade-identity.ts';

test('windowed current-season snapshots cannot demote an established trade', async () => {
  const db = await modelDatabase();
  try {
    await db.exec(`
      insert into seasons values (2026, 4, 2, true);
      insert into trades (
        season, trade_id, identity_key, effective_week, team_a, team_b,
        confidence, evidence_status
      ) values (
        2026, 'preseason-trade', 'roster:1:durable', 1, 4, 9,
        'reciprocal', 'active'
      );
    `);

    await execute(db, tradeWriteStatements(2026, []));
    assert.equal(
      (await db.query<{ evidence_status: string }>(
        "select evidence_status from trades where trade_id = 'preseason-trade'"
      )).rows[0]!.evidence_status,
      'active',
      'a later windowed snapshot must not erase an already-established current-season event',
    );

    await db.exec('update seasons set is_current = false where season = 2026');
    await execute(db, tradeWriteStatements(2026, []));
    assert.equal(
      (await db.query<{ evidence_status: string }>(
        "select evidence_status from trades where trade_id = 'preseason-trade'"
      )).rows[0]!.evidence_status,
      'needs_review',
      'completed-season rebuilds remain authoritative and still flag disappearing evidence',
    );
  } finally {
    await db.close();
  }
});
