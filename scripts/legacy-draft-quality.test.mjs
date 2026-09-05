import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function league(season) {
  const path = join(ROOT, 'data', 'history', String(season), 'league.json.gz');
  if (!existsSync(path)) return null;
  return JSON.parse(gunzipSync(readFileSync(path)).toString());
}

test('legacy draft boards contain only known-team picks or ESPN placeholder slots', () => {
  for (let season = 2005; season <= 2017; season += 1) {
    const data = league(season);
    if (!data) continue;
    const picks = data.draftDetail?.picks ?? [];
    const teamIds = new Set((data.teams ?? []).map((team) => team.id));
    const valid = picks.filter((pick) => pick.playerId !== 0 && teamIds.has(pick.teamId));
    const placeholders = picks.filter((pick) => pick.playerId === 0 || !teamIds.has(pick.teamId));
    const unknown = placeholders.filter((pick) => pick.playerId !== 0 && pick.teamId > 0 && !teamIds.has(pick.teamId));

    console.log(
      `${season}: raw=${picks.length} valid=${valid.length} placeholders=${placeholders.length} ` +
      `player0=${placeholders.filter((pick) => pick.playerId === 0).length} ` +
      `team0=${placeholders.filter((pick) => pick.teamId === 0).length} ` +
      `keepers=${picks.filter((pick) => pick.keeper).length}`
    );

    assert.equal(data.draftDetail?.drafted, true, `${season}: ESPN did not mark draft complete`);
    assert.ok(valid.length > 0, `${season}: no usable draft picks`);
    assert.deepEqual(unknown, [], `${season}: non-placeholder pick references an unknown team`);
  }
});
