/** Inspect evidence only: draft-to-final movement must never enter detectTrades. */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (url) => {const raw=JSON.parse(gunzipSync(readFileSync(url))); return Array.isArray(raw)?raw[0]:raw;};
const seasons=[];
for(let season=2005;season<=2017;season++) {
  const directory=new URL(`data/history/${season}/`,root);
  const league=read(new URL('league.json.gz',directory));
  const picks=league.draftDetail?.picks??[];
  const drafted=new Map(picks.map(p=>[p.playerId,p]));
  const teams=new Map(league.teams.map(t=>[t.id,t.name??[t.location,t.nickname].filter(Boolean).join(' ')]));
  const moves=[];
  for(const team of league.teams) for(const entry of team.roster?.entries??[]) {
    const player=entry.playerPoolEntry?.player;
    const pick=drafted.get(entry.playerId??player?.id);
    if(!pick || pick.teamId===team.id)continue;
    moves.push({espn_player_id:pick.playerId,name:player?.fullName??null,position_id:player?.defaultPositionId??null,
      overall_pick:pick.overallPickNumber,round:pick.roundId,from_team:pick.teamId,to_team:team.id,
      from_name:teams.get(pick.teamId),to_name:teams.get(team.id)});
  }
  const pairs=new Map();
  for(const move of moves) {
    const ids=[move.from_team,move.to_team].sort((a,b)=>a-b);const key=ids.join(':');
    const pair=pairs.get(key)??{team_a:ids[0],team_b:ids[1],moves:[]};pair.moves.push(move);pairs.set(key,pair);
  }
  const leads=[...pairs.values()].filter(p=>p.moves.some(m=>m.from_team===p.team_a)
    &&p.moves.some(m=>m.from_team===p.team_b));
  const boxDir=new URL('boxscores/',directory);
  seasons.push({season,source:`data/history/${season}/league.json.gz`,
    transactions:(league.transactions??[]).length,
    weekly_roster_files:existsSync(boxDir)?readdirSync(boxDir).filter(f=>f.endsWith('.gz')).length:0,
    confirmed_trades:0,gradeable_trades:0,
    coverage:'insufficient_trade_evidence',
    end_state_moves:moves,reciprocal_end_state_leads:leads});
}
const result={method:'Compare same-season draft ownership with the final roster. These are investigation leads, not trade records.',
  limitations:['No transaction packages or weekly ownership history survives in these archives.',
    'A final owner change can be a waiver claim, several transactions, or a trade. Reciprocal endpoint changes do not prove one deal.',
    'No effective dates, trade winners or grades can be inferred from these snapshots.'],seasons};
const output=new URL('data/derived/legacy-trade-evidence.json',root);
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(seasons.map(({season,transactions,weekly_roster_files,end_state_moves,reciprocal_end_state_leads})=>
  ({season,transactions,weekly_roster_files,owner_changes:end_state_moves.length,reciprocal_leads:reciprocal_end_state_leads.length})),null,2));
console.log(fileURLToPath(output));
