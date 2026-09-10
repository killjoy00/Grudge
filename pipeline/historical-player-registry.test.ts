import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDatabase, execute } from '../tests/models/database.ts';
import { historicalPlayerRegistryStatements } from './player-import.ts';
import { scoreStatements, type PlayerWeekScore } from './player-week.ts';

test('historical scoring seeds missing canonical players before enforcing the score FK', async () => {
  const db = await modelDatabase();
  try {
    const profile = { player_key: 'gsis:00-0099999', full_name: 'Historical Player', position: 'RB', bio: {} };
    const score: PlayerWeekScore = {
      season: 2005,
      week: 1,
      player_key: profile.player_key,
      espn_player_id: null,
      position_id: 2,
      points: 7.5,
      evidence: 'reconstructed',
      source: 'nflverse',
      scoring_version: 'historical-rules',
      input_hash: 'historical-score',
    };
    await execute(db, [
      ...historicalPlayerRegistryStatements([profile]),
      ...scoreStatements([score]),
    ]);
    const player = (await db.query<{full_name:string;position:string}>('select full_name, position from nfl_players where player_key=$1', [profile.player_key])).rows[0];
    assert.deepEqual(player, { full_name: 'Historical Player', position: 'RB' });
    assert.equal((await db.query('select * from player_week_scores where player_key=$1', [profile.player_key])).rows.length, 1);
  } finally {
    await db.close();
  }
});

test('historical registry seeding never overwrites a richer existing player profile', async () => {
  const db = await modelDatabase();
  try {
    const key = 'gsis:00-0088888';
    await db.query(`insert into nfl_players(player_key,full_name,position,bio) values($1,'Current Name','WR','{"headshot":"kept"}')`, [key]);
    await execute(db, historicalPlayerRegistryStatements([
      { player_key: key, full_name: 'Old Name', position: 'RB', bio: {} },
    ]));
    const row = (await db.query<{full_name:string;position:string;bio:{headshot:string}}>('select full_name, position, bio from nfl_players where player_key=$1', [key])).rows[0]!;
    assert.equal(row.full_name, 'Current Name');
    assert.equal(row.position, 'WR');
    assert.equal(row.bio.headshot, 'kept');
  } finally {
    await db.close();
  }
});
