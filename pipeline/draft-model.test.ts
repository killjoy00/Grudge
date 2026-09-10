import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { draftReplacement, draftProduction, gradeDrafts, expectedDraftProduction, type DraftPerformanceSeason } from './draft-model.ts';
import { draftInputsFromScores } from './model-publish.ts';
import type { PlayerWeekScore } from './player-week.ts';

function season(year: number): DraftPerformanceSeason {
  return { season:year,regular_weeks:13,team_count:1,total_picks:8,
    slot_counts:{0:1,2:1,4:1,6:1,23:1,17:1,16:1,20:5},
    pool:[["q1",1,300],["q2",1,200],["q3",1,100],
      ["r1",2,250],["r2",2,210],["r3",2,120],["r4",2,90],
      ["w1",3,240],["w2",3,190],["w3",3,110],
      ["t1",4,170],["t2",4,100],["t3",4,80]],
    picks:[{overall_pick:1,espn_team_id:1,espn_player_id:1,player_key:'gsis:q1',full_name:'First',position:2,fantasy_points:250,active_weeks:13,performance_source:'observed'},
      {overall_pick:8,espn_team_id:1,espn_player_id:2,player_key:'gsis:w3',full_name:'Last',position:3,fantasy_points:110,active_weeks:13,performance_source:'observed'}] };
}
test('replacement uses all NFL players and the actual FLEX allocation',()=>{
  const base=season(2025);const r=draftReplacement(base);
  assert.deepEqual(r.counts,[1,2,1,1]);
  assert.equal(r.levels.get(2),120);assert.equal(r.levels.get(3),190);
  const stronger=structuredClone(base);stronger.pool.push(['undrafted',3,280]);
  assert.deepEqual(draftReplacement(stronger).counts,[1,1,2,1]);
  assert.equal(draftReplacement(stronger).levels.get(2),210);
});
test('real production differences matter even when positional ranks do not change',()=>{
  const low=season(2025),high=season(2025);high.picks[0]!.fantasy_points=290;
  assert.ok(draftProduction([high])[0]!.production_score>draftProduction([low])[0]!.production_score);
  const scaled=structuredClone(low);scaled.pool=scaled.pool.map(([id,p,n])=>[id,p,2*n]);
  scaled.picks.forEach(p=>p.fantasy_points!*=2);
  assert.equal(draftProduction([scaled])[0]!.production_score,draftProduction([low])[0]!.production_score);
});
test('missing production blocks a whole season; a verified zero remains a graded outcome',()=>{
  const all=[2018,2019,2021,2022].map(season);
  all[3]!.picks[0]!.fantasy_points=null;
  assert.equal(gradeDrafts(all).filter(p=>p.season===2022).length,0);
  all[3]!.picks[0]!.fantasy_points=0;
  const pick=gradeDrafts(all).find(p=>p.season===2022&&p.overall_pick===1)!;
  assert.equal(pick.production_score,0);assert.ok(pick.value_delta<0);
});
test('expectations use full-board coordinates and exclude their own season',()=>{
  const data=draftProduction([2018,2019,2021,2022].map(season));
  const first=data[0]!,last=data[1]!;
  assert.ok(expectedDraftProduction(first,data)!>expectedDraftProduction(last,data)!);
  const changed=data.map(p=>p.season===first.season?{...p,production_score:9999}:p);
  assert.equal(expectedDraftProduction(first,data),expectedDraftProduction(first,changed));
  const late={...last,overall_pick:4};
  assert.ok(expectedDraftProduction(late,data)!>expectedDraftProduction(last,data)!);
  const historical=gradeDrafts([2018,2019,2021,2022].map(season),true);
  assert.deepEqual([...new Set(historical.map(p=>p.season))],[2022]);
});
test('the full recovered corpus passes identity/week coverage and restores missing injured picks',()=>{
  const bases:DraftPerformanceSeason[]=JSON.parse(readFileSync(new URL('../data/derived/draft-performance.json',import.meta.url),'utf8')).seasons;
  const source=JSON.parse(gunzipSync(readFileSync(new URL('../data/derived/player-week-scores.json.gz',import.meta.url))).toString());
  const scores:PlayerWeekScore[]=source.seasons.flatMap((s:any)=>s.rows.map((r:any)=>({season:s.season,week:r[3],player_key:`gsis:${r[0]}`,espn_player_id:r[1],position_id:r[2],points:r[4],evidence:r[5],source:'archive',scoring_version:s.scoring_hash,input_hash:'test'})));
  const boards=bases.flatMap(s=>(s.board??[]).map(([overall_pick,espn_team_id,espn_player_id])=>({season:s.season,overall_pick,espn_team_id,espn_player_id})));
  const input=draftInputsFromScores(bases,scores,boards);
  assert.ok(Object.values(input.coverage).every(c=>c.ready));
  const cook=input.seasons.find(s=>s.season===2017)!.picks.find(p=>p.espn_player_id===3116593)!;
  assert.ok(cook.fantasy_points!>0,'Dalvin Cook injury-shortened season is not zero');
  const irv=input.seasons.find(s=>s.season===2021)!.picks.find(p=>p.full_name.includes('Irv Smith'))!;
  assert.equal(irv.fantasy_points,0);assert.equal(irv.performance_source,'no_regular_season_stats');
  const missing=scores.filter(s=>!(s.season===2017&&s.week===1&&s.espn_player_id===3116593));
  assert.equal(draftInputsFromScores(bases,missing,boards).coverage[2017]!.ready,false);
});
