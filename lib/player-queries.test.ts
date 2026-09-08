import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelDatabase, execute } from '../tests/models/database.ts';
import { playerFilters, currentNflSeason, playerHref, decodePlayerKey, type PlayerRow, type PlayerHistoryEvent } from './player-data.ts';
import { playerListQuery, PLAYER_HISTORY_SQL, PLAYER_CONTRIBUTIONS_SQL } from './player-queries.ts';
import { playerRegistryStatements, playerSeasonStatements, validatePlayerSeason, type PlayerSeasonArtifact } from '../pipeline/player-import.ts';

async function database() {
  const db = await modelDatabase();
  await db.exec(`create table transactions (espn_transaction_id text primary key, season int, week int, type text, status text, is_pending boolean, raw jsonb);
    create table team_owners (season int, espn_team_id int, swid text);
    create table members (season int, swid text, display_name text, first_name text, last_name text);
    create table transaction_items (espn_transaction_id text, item_index int, espn_player_id bigint, item_type text, from_team_id int, to_team_id int);`);
  await db.exec(readFileSync(new URL('../scripts/migrations/2026-09-13-player-explorer.sql', import.meta.url), 'utf8'));
  return db;
}

function season(): PlayerSeasonArtifact {
  const games = [
    ['a', 3, 10, 'observed'], ['a', 6, 20, 'reconstructed'], ['a', 7, 90, 'observed'],
    ['b', 3, 0, 'observed'], ['c', 3, 12, 'observed'], ['c', 6, null, 'unavailable'],
  ].map(([key, week, points, evidence]) => ({season: 2024, player_key: String(key), season_type: 'REG', week: Number(week),
    game_id: `2024_${week}_BUF_KC`, team: 'BUF', opponent: 'KC', stats: {receiving_yards: 40},
    fantasy_points: points === null ? null : String(points), calculated_points: null, score_evidence: String(evidence)}));
  return {schema_version: 1, model_version: 'test', season: 2024, status: 'in_progress',
    players: ['a','b','c','d'].map(key=>({season: 2024, player_key: key, position: 'WR', teams: ['BUF']})),
    games, aliases: [{season: 2024, espn_player_id: 1, player_key: 'a', match_method: 'provider_id'}],
    rosters: [], regular_weeks: [3,6,7], postseason_weeks: [], scoring_items: [{statId: 53, points: .5}], scoring_hash: 'rules', sources: [], validation: {}};
}

test('player filters default to the NFL season and normalize safe, inclusive week ranges', () => {
  assert.equal(currentNflSeason(new Date('2027-01-15')), 2026);
  assert.equal(currentNflSeason(new Date('2027-09-15')), 2027);
  assert.deepEqual(playerFilters({season:'2024',position:'WR',from:'6',to:'3',sort:'points; drop table players'},2026),
    {season:2024,position:'WR',period:'REG',from:3,to:6,q:'',sort:'points',direction:'desc',page:1});
  assert.equal(playerFilters({},2026).season, 2026);
});

test('a linked player key survives the round trip through the route segment', () => {
  const segment = (key: string) => playerHref(key, 2024).slice('/players/'.length).split('?')[0]!;
  for (const key of ['gsis:00-0036900', 'archive:2024:4046692', 'archive:2011:-16007']) {
    assert.notEqual(segment(key), key, 'the colon is percent-encoded in the path');
    assert.equal(decodePlayerKey(segment(key)), key);
    assert.equal(decodePlayerKey(key), key, 'a segment Next already decoded is unchanged');
  }
  assert.equal(decodePlayerKey('gsis:100%'), 'gsis:100%', 'an undecodable segment is passed through');
});

test('SQL filters weeks, includes unrostered players, keeps zero distinct from absent and withholds incomplete totals', async () => {
  const db = await database();
  try {
    await execute(db, playerRegistryStatements(['a','b','c','d'].map(key=>({player_key:key,full_name:`Player ${key}`,position:'WR',bio:{}}))));
    const s = season(); await execute(db, playerSeasonStatements(s, 'hash1'));
    const query = playerListQuery(playerFilters({season:'2024',position:'WR',from:'3',to:'6'},2026));
    const {rows} = await db.query<PlayerRow>(query.text, query.params);
    assert.equal(rows.length, 4); assert.equal(rows[0]!.player_key, 'a');
    assert.equal(Number(rows[0]!.points), 30); assert.equal(Number(rows[0]!.average),15); assert.equal(rows[0]!.games,2);
    assert.equal(Number(rows.find(p=>p.player_key==='b')!.points),0);
    assert.equal(rows.find(p=>p.player_key==='c')!.points,null);
    assert.equal(rows.find(p=>p.player_key==='d')!.points,null);
    assert.equal(rows.find(p=>p.player_key==='d')!.games,0);
    await execute(db, playerSeasonStatements(s, 'hash1'));
    assert.equal((await db.query('select * from nfl_player_games')).rows.length,6,'idempotent import');
    await db.exec('set role app_user');
    assert.equal((await db.query(query.text, query.params)).rows.length,4,'public app can read');
    await assert.rejects(db.query("insert into nfl_players values ('attack','Bad','WR','{}')"), /permission denied/);
    await db.exec('reset role');
    const broken = structuredClone(s); broken.games[0]!.player_key = 'not-in-registry';
    assert.throws(()=>validatePlayerSeason(broken), /Invalid or duplicate/);
    const tooSmall = structuredClone(s); tooSmall.games = []; tooSmall.regular_weeks=[]; tooSmall.status='awaiting_games';
    await assert.rejects(execute(db, playerSeasonStatements(tooSmall, 'bad')), /division by zero/);
    assert.equal((await db.query('select * from nfl_player_games')).rows.length,6,'failed publication leaves old rows intact');
    const corrected = structuredClone(s); corrected.players = corrected.players.filter(p => p.player_key !== 'd');
    await execute(db, playerSeasonStatements(corrected, 'corrected'));
    assert.equal((await db.query('select * from nfl_player_seasons')).rows.length,3,'retired archive aliases do not leave duplicate directory entries');
  } finally { await db.close(); }
});

test('career history respects season identity, actual managers, completed moves and stable active trades', async () => {
  const db = await database();
  try {
    await db.exec(`insert into nfl_players values ('old','Old Player','WR','{}'),('new','New Player','WR','{}');
      insert into nfl_player_aliases values (2005,1,'old','season_name_position'),(2024,1,'new','provider_id'),(2026,1,'new','provider_id');
      insert into draft_picks values (2005,2,1,2,4,1),(2024,40,4,10,4,1),(2026,50,5,10,8,1);
      insert into team_owners values (2026,8,'owner');
      insert into members values (2026,'owner','Fantasy Nickname','Jonathan','Crisp');
      insert into team_franchise values (2005,4,'penguins','Penguins'),(2024,4,'penguins','Penguins'),(2024,8,'yuppies','Yuppies');
      insert into managers values ('mike','Mike'),('joe','Joe'),('jon','Jon');
      insert into manager_franchise_seasons values (2005,'penguins','joe',true),(2024,'penguins','mike',true),(2024,'yuppies','jon',true);
      insert into roster_entries values (2024,3,4,1,0,true,10),(2024,4,4,1,20,false,20),(2024,6,8,1,0,true,25);
      insert into seasons (season, regular_season_weeks) values (2024,4);
      insert into weeks values (2024,3,true),(2024,4,true),(2024,6,true);
      insert into matchups values (2024,3,4,8,'NONE'),(2024,4,4,8,'NONE'),(2024,6,4,8,'LOSERS_CONSOLATION');
      insert into trades (season,trade_id,effective_week,team_a,team_b,confidence,evidence_status)
        values (2024,'stable',6,4,8,'ledger','active'),(2024,'withdrawn',7,4,8,'reciprocal','needs_review');
      insert into trade_players values (2024,'stable',1,4,8),(2024,'withdrawn',1,8,4);
      insert into transactions values
        ('done',2024,2,'WAIVER','EXECUTED',false,'{"processDate":1726000000000,"items":[{"playerId":1}]}'),
        ('failed',2024,5,'WAIVER','FAILED_ROSTERLIMIT',false,'{}'),
        ('pending',2024,7,'TRADE_PROPOSAL','PENDING',true,'{}');
      insert into transaction_items values ('done',0,null,'ADD',0,4),('failed',0,1,'ADD',0,8),('pending',0,1,'TRADE',4,8);`);
    const events = (await db.query<PlayerHistoryEvent>(PLAYER_HISTORY_SQL,['new'])).rows;
    assert.equal(events.filter(e=>e.kind==='trade').length,1);
    assert.equal(events.filter(e=>e.kind==='waiver').length,1,'recover ID from raw completed item');
    assert.equal(events.find(e=>e.kind==='draft' && e.season===2024)!.managers,'Mike');
    assert.equal(events.find(e=>e.kind==='draft' && e.season===2026)!.managers,'Jonathan Crisp');
    assert.equal(events.find(e=>e.kind==='trade')!.managers,'Jon');
    assert.equal(events.find(e=>e.kind==='trade')!.other_managers,'Mike');
    assert.equal(events.some(e=>e.season===2005),false,'old reused ESPN identity stays on old player');
    assert.deepEqual(events.filter(e=>e.kind==='roster').map(e=>[e.week,e.end_week]),[[6,6],[3,4]]);
    const old = (await db.query<PlayerHistoryEvent>(PLAYER_HISTORY_SQL,['old'])).rows;
    assert.equal(old[0]!.managers,'Joe');
    const contribution = (await db.query<{points:string;starts:number}>(PLAYER_CONTRIBUTIONS_SQL,['new'])).rows;
    assert.equal(contribution.length,1); assert.equal(Number(contribution[0]!.points),10); assert.equal(contribution[0]!.starts,1);
  } finally { await db.close(); }
});
