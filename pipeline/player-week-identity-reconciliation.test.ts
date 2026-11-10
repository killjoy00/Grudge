import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDatabase, execute } from '../tests/models/database.ts';
import { scoreStatements, type PlayerWeekScore } from './player-week.ts';

const fallback = 'espn:4686658';
const canonical = 'gsis:00-0040878';
const staleSynthetic = 'gsis:WAS569019';

function observed(points: number, input_hash = String(points)): PlayerWeekScore {
  return {
    season: 2026, week: 5, player_key: fallback, espn_player_id: 4686658,
    position_id: 3, points, evidence: 'observed', source: 'espn_weekly',
    scoring_version: 'week-5', input_hash,
  };
}

async function seedPlayers(db: Awaited<ReturnType<typeof modelDatabase>>) {
  await db.query(`
    insert into nfl_players (player_key, full_name, position, bio)
      values ($1, 'Provider placeholder', 'WR', '{}'::jsonb),
             ($2, 'Canonical player', 'WR', '{}'::jsonb)
  `, [fallback, canonical]);
}

async function addAlias(db: Awaited<ReturnType<typeof modelDatabase>>) {
  await db.query(`
    insert into nfl_player_aliases(season, espn_player_id, player_key, match_method)
      values (2026, 4686658, $1, 'provider_crosswalk')
  `, [canonical]);
}

async function savedScores(db: Awaited<ReturnType<typeof modelDatabase>>) {
  return (await db.query<{
    player_key: string; espn_player_id: string | null;
    points: string | null; source: string; input_hash: string;
  }>(`
    select player_key, espn_player_id, points, source, input_hash
      from player_week_scores where season=2026 and week=5
      order by player_key
  `)).rows;
}

test('weekly model refresh reuses a canonical player-week behind the ESPN ID', async () => {
  const db = await modelDatabase();
  try {
    await seedPlayers(db);
    await addAlias(db);
    await db.query(`
      insert into player_week_scores(season,week,player_key,espn_player_id,
        position_id,points,evidence,source,scoring_version,input_hash)
      values (2026,5,$1,4686658,3,8,'observed','espn_weekly','old','old')
    `, [canonical]);
    await execute(db, scoreStatements([observed(12)]));
    await execute(db, scoreStatements([observed(12)]));
    const rows = await savedScores(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.player_key, canonical);
    assert.equal(Number(rows[0]?.points), 12);
    assert.equal(rows[0]?.input_hash, '12');
  } finally { await db.close(); }
});

test('missing alias still keeps an existing GSIS score key rather than downgrading it to ESPN', async () => {
  const db = await modelDatabase();
  try {
    await seedPlayers(db);
    await db.query(`
      insert into player_week_scores(season,week,player_key,espn_player_id,
        position_id,points,evidence,source,scoring_version,input_hash)
      values (2026,5,$1,4686658,3,8,'observed','espn_weekly','old','old')
    `, [canonical]);
    await execute(db, scoreStatements([observed(10)]));
    const rows = await savedScores(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.player_key, canonical);
    assert.equal(Number(rows[0]?.points), 10);
  } finally { await db.close(); }
});

test('reviewed alias safely upgrades a legacy ESPN placeholder in place', async () => {
  const db = await modelDatabase();
  try {
    await seedPlayers(db);
    await db.query(`
      insert into player_week_scores(season,week,player_key,espn_player_id,
        position_id,points,evidence,source,scoring_version,input_hash)
      values (2026,5,$1,4686658,3,8,'observed','espn_weekly','old','old')
    `, [fallback]);
    await addAlias(db);
    await execute(db, scoreStatements([observed(12)]));
    await execute(db, scoreStatements([observed(12)]));
    const rows = await savedScores(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.player_key, canonical);
    assert.equal(Number(rows[0]?.points), 12);
  } finally { await db.close(); }
});

test('an occupied canonical slot is a genuine identity conflict and rolls back', async () => {
  const db = await modelDatabase();
  try {
    await seedPlayers(db);
    await addAlias(db);
    await db.query(`
      insert into player_week_scores(season,week,player_key,espn_player_id,
        position_id,points,evidence,source,scoring_version,input_hash)
      values (2026,5,$1,4686658,3,8,'observed','espn_weekly','old','old'),
             (2026,5,$2,null,3,7,'reconstructed','nflverse','old','historical')
    `, [fallback, canonical]);
    await assert.rejects(execute(db, scoreStatements([observed(12)])));
    const rows = await savedScores(db);
    assert.equal(rows.length, 2, 'must not silently merge or lose historical evidence');
    assert.equal(rows.find(r => r.player_key === fallback)?.input_hash, 'old');
    assert.equal(rows.find(r => r.player_key === canonical)?.input_hash, 'historical');
  } finally { await db.close(); }
});


test('2026 week 5: the authoritative alias safely replaces an earlier synthetic GSIS score key', async () => {
  const db = await modelDatabase();
  try {
    await seedPlayers(db);
    await db.query(`
      insert into nfl_players(player_key,full_name,position,bio)
      values($1,'Earlier ESPN synthetic identity','WR','{}')
    `, [staleSynthetic]);
    await addAlias(db);
    await db.query(`
      insert into player_week_scores(season,week,player_key,espn_player_id,
        position_id,points,evidence,source,scoring_version,input_hash)
      values(2026,5,$1,4686658,3,8,'observed','espn_weekly','old','old')
    `, [staleSynthetic]);
    const changed = { ...observed(12), player_key: staleSynthetic };
    await execute(db, scoreStatements([changed]));
    await execute(db, scoreStatements([changed]));
    const rows = await savedScores(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.player_key, canonical);
    assert.equal(Number(rows[0]?.points), 12);
    assert.equal(rows[0]?.input_hash, '12');
  } finally { await db.close(); }
});

test('a prior GSIS identity assigned to another ESPN player cannot be silently rekeyed', async () => {
  const db = await modelDatabase();
  try {
    await seedPlayers(db);
    await db.query(`
      insert into nfl_players(player_key,full_name,position,bio)
      values($1,'Another provider identity','WR','{}')
    `, [staleSynthetic]);
    await addAlias(db);
    await db.query(`
      insert into nfl_player_aliases(season,espn_player_id,player_key,match_method)
      values(2026,9999999,$1,'reviewed')
    `, [staleSynthetic]);
    await db.query(`
      insert into player_week_scores(season,week,player_key,espn_player_id,
        position_id,points,evidence,source,scoring_version,input_hash)
      values(2026,5,$1,4686658,3,8,'observed','espn_weekly','old','old')
    `, [staleSynthetic]);
    await assert.rejects(execute(db, scoreStatements([{ ...observed(12), player_key: staleSynthetic }])));
    const rows = await savedScores(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.player_key, staleSynthetic);
    assert.equal(rows[0]?.input_hash, 'old');
  } finally { await db.close(); }
});
