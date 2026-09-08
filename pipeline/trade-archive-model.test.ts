import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { completedWeeks, matchupRows, playerRows, rosterEntryRows, starterSlots } from './normalize.ts';
import { detectTrades } from './trade-history.ts';
import { seasonContext, valueTrade, type SeasonPlayerRow } from './trade-value.ts';
import { observedPlayerWeeks } from './player-week.ts';
import { isTrackedGame } from '../lib/playoff-policy.ts';
import type { EspnLeague } from './espn.ts';

const read = (url: URL) => JSON.parse(gunzipSync(readFileSync(url)).toString());

test('real trade archive replay keeps both corrected playoff verdicts and reports coverage',()=>{
  const corpus=read(new URL('../data/derived/player-week-scores.json.gz',import.meta.url));
  const values:{season:number;week:number;a:number;b:number;graded:boolean;winner:number|null;reason:unknown}[]=[];
  for(const year of [2018,2019,2021,2022,2023,2024,2025]) {
    const dir=new URL(`../data/history/${year}/`,import.meta.url);
    const league=read(new URL('league.json.gz',dir)) as EspnLeague;
    const weeks=completedWeeks(league);const regular=league.settings!.scheduleSettings.matchupPeriodCount!;
    const games=matchupRows(league).filter(m=>weeks.includes(m.week)&&isTrackedGame(m.week,regular,m.playoff_tier))
      .flatMap(m=>[m.home_team_id,m.away_team_id].filter((team_id):team_id is number=>team_id!==null).map(team_id=>({week:m.week,team_id})));
    const gameKeys=new Set(games.map(g=>`${g.week}:${g.team_id}`));
    const profiles=new Map<number,SeasonPlayerRow>();
    const rows:ReturnType<typeof rosterEntryRows>=[];
    for(const f of readdirSync(new URL('boxscores/',dir)).sort()) {
      const m=/^sp(\d+)\.json\.gz$/.exec(f);if(!m||!weeks.includes(Number(m[1])))continue;
      const bx=read(new URL(`boxscores/${f}`,dir)) as EspnLeague;
      rows.push(...rosterEntryRows(bx,Number(m[1]),starterSlots(league)));
      for(const p of playerRows(bx))if(!profiles.has(p.espn_player_id))profiles.set(p.espn_player_id,p);
    }
    const position=new Map([...profiles.values()].map(p=>[p.espn_player_id,p.default_position_id!]));
    const raw=observedPlayerWeeks(rows,position,'archive-test');
    const points=new Map<string,{week:number;espn_player_id:number;points:number|null;started:boolean}>();
    for(const r of corpus.seasons.find((s:any)=>s.season===year).rows as [string,number|null,number,number,number,string][]) {
      if(r[1]===null)continue;
      if(!profiles.has(r[1]))profiles.set(r[1],{espn_player_id:r[1],default_position_id:r[2],eligible_slots:null});
      points.set(`${r[3]}:${r[1]}`,{week:r[3],espn_player_id:r[1],points:r[4],started:false});
    }
    const starters=new Set(rows.filter(r=>r.is_starter).map(r=>`${r.week}:${r.espn_player_id}`));
    for(const r of raw)points.set(`${r.week}:${r.espn_player_id}`,{week:r.week,espn_player_id:r.espn_player_id!,points:r.points,started:starters.has(`${r.week}:${r.espn_player_id}`)});
    const context=seasonContext(rows.map(r=>({...r,tracked:gameKeys.has(`${r.week}:${r.espn_team_id}`)})),
      [...profiles.values()],league.teams!.length,{points:[...points.values()],weeks,regularWeeks:regular,trackedGames:games});
    for(const t of detectTrades(year,rows,league.transactions??[])) {
      const v=valueTrade({...t,moves:t.players,...context});
      values.push({season:year,week:t.effective_week,a:t.team_a,b:t.team_b,graded:v.graded,winner:v.winner,reason:v.gradingReason});
    }
  }
  assert.equal(values.length,31);
  console.log('Archive trade coverage',JSON.stringify({trades:values.length,graded:values.filter(v=>v.graded).length,withheld:values.filter(v=>!v.graded)}));
  assert.equal(values.find(v=>v.season===2022&&v.week===9&&v.a===1&&v.b===4)!.winner,4);
  assert.equal(values.find(v=>v.season===2024&&v.week===6&&v.a===4&&v.b===8)!.winner,8);
  assert.ok(values.filter(v=>v.graded).length>=29);
});
