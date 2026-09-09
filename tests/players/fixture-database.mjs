/** CI-only PostgreSQL fixture behind Neon's wire format. Never loaded by the app.
 * The rendered pages execute their real SQL against PGlite with app_user rights.
 * All NFL stats come from the committed, checksum-validated season artifacts.
 */
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {modelDatabase, execute} from '../models/database.ts';
import {playerRegistryStatements, playerSeasonStatements} from '../../pipeline/player-import.ts';

if (process.env.APP_DATABASE_URL !== 'postgresql://app_user:fixture@player-fixture.invalid/neondb')
  throw new Error('Player UI fixtures require the isolated fixture URL');
const db = await modelDatabase();
await db.exec(`create table transactions (espn_transaction_id text primary key, season int, week int, type text, status text, is_pending boolean, raw jsonb);
  create table transaction_items (espn_transaction_id text, item_index int, espn_player_id bigint, item_type text, from_team_id int, to_team_id int);
  create table team_owners (season int, espn_team_id int, swid text);
  create table members (season int, swid text, display_name text, first_name text, last_name text);`);
await db.exec(readFileSync(new URL('../../scripts/migrations/2026-09-13-player-explorer.sql', import.meta.url),'utf8'));
const artifact = name => JSON.parse(gunzipSync(readFileSync(new URL(`../../data/derived/players/${name}.json.gz`,import.meta.url))).toString());
await execute(db, playerRegistryStatements(artifact('registry').players));
for (const year of [2005,2024,2025,2026]) await execute(db,playerSeasonStatements(artifact(year),`fixture-${year}`));
// Recorded example: Mahomes was drafted by Michael Chepul and moved to
// Jonathan Crisp's roster in week 6. The SQL unit suite covers rejected moves,
// old ID reuse, co-owners, missing points and consolation exclusions separately.
await db.exec('insert into seasons (season,regular_season_weeks) values (2024,14)');
await db.exec(`insert into draft_picks values (2024,40,4,10,4,3139477);
  insert into franchises values ('the-penguins','The Penguins'),('brightleaf-yuppies','Brightleaf Yuppies');
  insert into franchise_season_teams values
    (2024,'the-penguins',4,'The Penguins'),
    (2024,'brightleaf-yuppies',8,'Brightleaf Yuppies');
  insert into team_franchise values (2024,4,'the-penguins','The Penguins'),(2024,8,'brightleaf-yuppies','Brightleaf Yuppies');
  insert into managers values ('michael-chepul','Michael Chepul'),('jonathan-crisp','Jonathan Crisp');
  insert into manager_franchise_seasons values (2024,'the-penguins','michael-chepul',true),(2024,'brightleaf-yuppies','jonathan-crisp',true);
  insert into trades (season,trade_id,effective_week,team_a,team_b,confidence,evidence_status)
    values (2024,'2024-w6-4v8',6,4,8,'reciprocal','active');
  insert into trade_players(season,trade_id,espn_player_id,from_team_id,to_team_id,player_key)
    select 2024,'2024-w6-4v8',3139477,4,8,player_key
      from nfl_player_aliases where season=2024 and espn_player_id=3139477;
  grant select on all tables in schema public to app_user;
  set role app_user;`);

function wire(value, oid) {
  if (value == null) return null;
  if (oid === 16) return value ? 't' : 'f';
  if (oid === 114 || oid === 3802) return JSON.stringify(value);
  if (Array.isArray(value)) return `{${value.map(v=>v == null ? 'NULL' : `"${String(v).replaceAll('\\','\\\\').replaceAll('"','\\"')}"`).join(',')}}`;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
async function query(q) {
  const result = await db.query(q.query,q.params ?? [],{rowMode:'array'});
  return {...result, rows:result.rows.map(row=>row.map((value,i)=>wire(value,result.fields[i].dataTypeID))), rowCount:result.rows.length};
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const target = typeof url === 'string' || url instanceof URL ? String(url) : url.url;
  if (!['player-fixture.invalid', 'api.invalid'].includes(new URL(target).hostname)) return nativeFetch(url, options);
  try {
    const payload=JSON.parse(options.body);
    const result=payload.queries ? {results:await Promise.all(payload.queries.map(query))} : await query(payload);
    return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
  } catch(error) {
    console.error('Player fixture query failed:',error.message);
    return new Response(JSON.stringify({message:error.message,code:error.code}),{status:400,headers:{'content-type':'application/json'}});
  }
};
console.log('Player UI PostgreSQL fixture ready');
