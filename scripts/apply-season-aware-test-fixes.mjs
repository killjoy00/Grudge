#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const text = readFileSync(path, 'utf8');
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one match, found ${count}`);
  writeFileSync(path, text.replace(before, after));
}

replaceOnce('pipeline/draft-model.test.ts',
`    picks:[{overall_pick:1,espn_team_id:1,espn_player_id:1,full_name:'First',position:2,fantasy_points:250,active_weeks:13,performance_source:'observed'},\n      {overall_pick:8,espn_team_id:1,espn_player_id:2,full_name:'Last',position:3,fantasy_points:110,active_weeks:13,performance_source:'observed'}] };\n`,
`    picks:[{overall_pick:1,espn_team_id:1,espn_player_id:1,player_key:'gsis:q1',full_name:'First',position:2,fantasy_points:250,active_weeks:13,performance_source:'observed'},\n      {overall_pick:8,espn_team_id:1,espn_player_id:2,player_key:'gsis:w3',full_name:'Last',position:3,fantasy_points:110,active_weeks:13,performance_source:'observed'}] };\n`);

replaceOnce('pipeline/model-publish.test.ts',
`espn_player_id: 13103, player_key, full_name: 'Michael Bennett'`,
`espn_player_id: 13103, player_key: playerKey, full_name: 'Michael Bennett'`);

console.log('Applied season-aware identity test fixture fixes');
