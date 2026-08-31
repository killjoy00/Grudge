/**
 * Tests for the raw-archive change detector.
 *
 * This exists because the detector has two opposite failure modes and only one
 * of them is obvious. If it is too eager, every Tuesday commits a few hundred
 * KB of ESPN analyst-ranking noise forever, burying the weeks where something
 * actually happened. If it is too lazy, a real result is silently never
 * archived -- far worse, and invisible until someone needs the history.
 *
 * So both directions are asserted: the volatile fields must NOT trigger a
 * write, and anything about the league itself MUST.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { writeRaw, stableProjection, VOLATILE_KEYS } from './run.ts';

/** A payload shaped like ESPN's, carrying both real and volatile fields. */
function base() {
  return {
    schedule: [
      { id: 1, matchupPeriodId: 1, winner: 'UNDECIDED',
        home: { teamId: 1, totalPoints: 0 }, away: { teamId: 6, totalPoints: 0 } },
    ],
    transactions: [{ id: 'x', type: 'DRAFT', bidAmount: 0 }],
    teams: [{
      id: 1,
      roster: { entries: [{
        playerId: 9, lineupSlotId: 0,
        playerPoolEntry: {
          appliedStatTotal: 0,
          player: {
            id: 9, fullName: 'A. Player',
            rankings: { '0': [{ rank: 5, averageRank: 5.5 }] },
            draftRanksByRankType: { STANDARD: { rank: 10, auctionValue: 8 } },
            ownership: { percentOwned: 50.1, percentChange: 0.2 },
            lastNewsDate: 1788000000000,
          },
        },
      }] },
    }],
  };
}

function scratch() {
  return join(mkdtempSync(join(tmpdir(), 'archive-test-')), 'league.json.gz');
}

/** Seed the archive, apply a mutation, report whether it wrote. */
function wroteAfter(mutate: (d: ReturnType<typeof base>) => void): boolean {
  const path = scratch();
  writeRaw(path, base());
  const next = base();
  mutate(next);
  return writeRaw(path, next);
}

test('an identical payload is not rewritten', () => {
  const path = scratch();
  assert.equal(writeRaw(path, base()), true, 'first write must happen');
  assert.equal(writeRaw(path, base()), false, 'identical payload must not rewrite');
});

test('volatile analyst fields do NOT trigger a rewrite', () => {
  // Measured against real data: two archives taken hours apart differed in 60
  // values, all of them in these fields, while every score and roster matched.
  assert.equal(wroteAfter((d) => {
    d.teams[0]!.roster.entries[0]!.playerPoolEntry.player.rankings['0']![0]!.rank = 4;
  }), false, 'analyst rank change');

  assert.equal(wroteAfter((d) => {
    d.teams[0]!.roster.entries[0]!.playerPoolEntry.player.ownership.percentOwned = 61.2;
  }), false, 'ownership percentage change');

  assert.equal(wroteAfter((d) => {
    d.teams[0]!.roster.entries[0]!.playerPoolEntry.player.draftRanksByRankType.STANDARD.rank = 3;
  }), false, 'projected draft rank change');

  assert.equal(wroteAfter((d) => {
    d.teams[0]!.roster.entries[0]!.playerPoolEntry.player.lastNewsDate = 1788999999999;
  }), false, 'news timestamp change');
});

test('real league changes DO trigger a rewrite', () => {
  assert.equal(wroteAfter((d) => { d.schedule[0]!.winner = 'HOME'; }),
    true, 'a game being decided');

  assert.equal(wroteAfter((d) => { d.schedule[0]!.home.totalPoints = 118.4; }),
    true, 'a score changing');

  assert.equal(wroteAfter((d) => { d.transactions.push({ id: 'y', type: 'WAIVER', bidAmount: 12 }); }),
    true, 'a new transaction');

  assert.equal(wroteAfter((d) => { d.teams[0]!.roster.entries[0]!.playerId = 77; }),
    true, 'a roster move');

  assert.equal(wroteAfter((d) => { d.teams[0]!.roster.entries[0]!.lineupSlotId = 20; }),
    true, 'a start/sit change');

  assert.equal(wroteAfter((d) => {
    d.teams[0]!.roster.entries[0]!.playerPoolEntry.appliedStatTotal = 22.6;
  }), true, 'a player scoring points');
});

test('the archive written is the FULL payload, volatile fields included', () => {
  // The projection is for change detection only. Stripping the archive itself
  // would quietly discard data we might want for a feature not yet built.
  const path = scratch();
  writeRaw(path, base());
  const stored = JSON.parse(gunzipSync(readFileSync(path)).toString());
  const player = stored.teams[0].roster.entries[0].playerPoolEntry.player;
  assert.ok(player.rankings, 'rankings must survive into the archive');
  assert.ok(player.ownership, 'ownership must survive into the archive');
  assert.ok(player.draftRanksByRankType, 'draft ranks must survive into the archive');
});

test('stableProjection strips exactly the volatile keys, nothing else', () => {
  const projected = stableProjection(base()) as Record<string, unknown>;
  const player = (projected as any).teams[0].roster.entries[0].playerPoolEntry.player;
  for (const k of VOLATILE_KEYS) {
    assert.equal(player[k], undefined, `${k} should be projected away`);
  }
  assert.equal(player.id, 9, 'identity must survive');
  assert.equal(player.fullName, 'A. Player', 'name must survive');
  assert.ok((projected as any).schedule, 'schedule must survive');
  assert.ok((projected as any).transactions, 'transactions must survive');
});

test('a corrupt existing archive is rewritten rather than trusted', () => {
  const path = scratch();
  writeFileSync(path, Buffer.from('not gzip at all'));
  assert.equal(writeRaw(path, base()), true, 'unreadable archive must be replaced');
  const stored = JSON.parse(gunzipSync(readFileSync(path)).toString());
  assert.equal(stored.teams[0].id, 1);
});
