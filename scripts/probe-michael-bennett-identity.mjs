#!/usr/bin/env node

function parseCsv(text) {
  const rows=[]; let row=[], field='', q=false;
  for (let i=0;i<text.length;i++) { const c=text[i];
    if(q){ if(c==='"'&&text[i+1]==='"'){field+='"';i++;} else if(c==='"')q=false; else field+=c; }
    else if(c==='"')q=true; else if(c===','){row.push(field);field='';} else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';} else field+=c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/,'')); rows.push(row); }
  const h=rows.shift()??[]; return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((x,i)=>[x,r[i]??''])));
}
async function csv(url){ const r=await fetch(url,{headers:{'user-agent':'Grudge historical identity audit'}}); if(!r.ok)throw new Error(`${url} ${r.status}`); return parseCsv(await r.text()); }

const espnIds = new Set(['13103','13370','13376','13554']);
const gsisIds = new Set(['00-0020514','00-0026857','00-0020446','00-0027503','00-0020498','00-0027725','00-0020536','00-0027248']);
const ids = await csv('https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv');
for (const row of ids.filter((r) => espnIds.has(r.espn_id) || gsisIds.has(r.gsis_id))) console.log('CROSSWALK', JSON.stringify(row));

for (const year of [2005,2009,2010,2011]) {
  const stats = await csv(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`);
  const rows = stats.filter((r) => gsisIds.has(r.player_id));
  const by = new Map();
  for (const row of rows) {
    if (!by.has(row.player_id)) by.set(row.player_id,{year,gsis:row.player_id,name:row.player_display_name,position:row.position,team:row.recent_team,weeks:0});
    by.get(row.player_id).weeks += 1;
  }
  for (const x of by.values()) console.log('STATS', JSON.stringify(x));
}
