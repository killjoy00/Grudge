/**
 * Tests for the free-agent pool normalizer.
 *
 * Run against the real kona_player_info capture in exploration/raw/, not a
 * fixture I wrote -- a fixture would only prove the normalizer matches my own
 * beliefs about the payload, which is exactly the assumption Step 1 existed to
 * remove.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freeAgentRows } from './normalize.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const payload = JSON.parse(
  readFileSync(join(ROOT, 'exploration/raw/2026_kona_player_info.json'), 'utf8')
);

test('parses the real kona_player_info capture', () => {
  const rows = freeAgentRows(payload);
  assert.equal(rows.length, 25, 'the capture holds 25 pool players');

  const hunter = rows.find((r) => r.full_name === 'Travis Hunter');
  assert.ok(hunter, 'Travis Hunter is in the capture');
  // Asserted against the archived values, so a change in how ownership is read
  // fails here rather than silently shifting every trend on the admin page.
  assert.equal(hunter.percent_owned, 73.4);
  assert.equal(hunter.percent_change, 0.63);
  assert.equal(hunter.percent_started, 6);
  assert.equal(hunter.auction_value_avg, 1.66);
  assert.equal(hunter.avg_draft_position, 119.56);
});

test('D/ST units keep their negative player ids', () => {
  // -16017, -16005 and -16012 are all real in the capture. A `> 0` guard or an
  // unsigned column anywhere in this path would drop every defence.
  const rows = freeAgentRows(payload);
  const negative = rows.filter((r) => r.espn_player_id < 0);
  assert.equal(negative.length, 3, 'three D/ST units in the capture');
  for (const d of negative) {
    assert.match(d.full_name, /D\/ST$/, 'negative ids are defences');
  }
});

test('status is passed through verbatim, not coerced to an enum', () => {
  // Every observed row is WAIVERS. If a future payload says FREEAGENT -- or
  // something we have never seen -- it must reach the column unchanged rather
  // than being mapped into a guess.
  const rows = freeAgentRows(payload);
  assert.ok(rows.every((r) => r.status === 'WAIVERS'), 'the capture is all waivers');

  const invented = freeAgentRows({
    players: [{
      id: 1, status: 'SOMETHING_NEW', onTeamId: 0,
      player: { fullName: 'X', ownership: { percentOwned: 1 } },
    }],
  });
  assert.equal(invented[0]?.status, 'SOMETHING_NEW', 'unknown status survives intact');
});

test('a missing ownership number is null, not zero', () => {
  // "Nobody owns this player" and "ESPN did not tell us" are different facts,
  // and averaging them together would quietly bias every trend toward zero.
  const rows = freeAgentRows({
    players: [{ id: 5, status: 'WAIVERS', onTeamId: 0, player: { fullName: 'No Ownership Data' } }],
  });
  assert.equal(rows[0]?.percent_owned, null);
  assert.equal(rows[0]?.percent_change, null);
  assert.equal(rows[0]?.auction_value_avg, null);
});

test('entries without a usable player are skipped, not defaulted', () => {
  const rows = freeAgentRows({
    players: [
      { id: 1, player: { fullName: 'Real Player' } },
      { id: 2, player: {} },              // no name
      { id: 3 },                          // no player object
      { player: { fullName: 'No Id' } },  // no id
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.full_name, 'Real Player');
});

test('duplicate ids are collapsed before they can violate the primary key', () => {
  // The snapshot table is keyed on (season, week, espn_player_id). A repeated
  // id would abort the transaction mid-write rather than at the boundary.
  const rows = freeAgentRows({
    players: [
      { id: 9, player: { fullName: 'First', ownership: { percentOwned: 10 } } },
      { id: 9, player: { fullName: 'Second', ownership: { percentOwned: 20 } } },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.percent_owned, 20, 'last entry wins');
});

test('a malformed payload yields no rows rather than throwing', () => {
  // The loader treats an empty result as "write nothing", so degrading to empty
  // is safe. Throwing here would fail the whole weekly job over a bad response.
  assert.deepEqual(freeAgentRows(null), []);
  assert.deepEqual(freeAgentRows({}), []);
  assert.deepEqual(freeAgentRows({ players: [] }), []);
});
