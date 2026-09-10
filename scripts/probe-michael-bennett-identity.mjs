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

const ids = await csv('https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv');
for (const row of ids.filter((r) => r.espn_id === '13103' || ['00-0020514','00-0026857'].includes(r.gsis_id))) {
  console.log('CROSSWALK', JSON.stringify(row));
}

for (const year of [2004,2005,2006,2007,2008,2009,2010]) {
  const stats = await csv(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`);
  const rows = stats.filter((r) => ['00-0020514','00-0026857'].includes(r.player_id));
  const by = new Map();
  for (const row of rows) {
    const key = row.player_id;
    if (!by.has(key)) by.set(key,{year,gsis:key,name:row.player_display_name,position:row.position,team:row.recent_team,weeks:0,rushYards:0,recYards:0});
    const x=by.get(key); x.weeks += 1; x.rushYards += Number(row.rushing_yards||0); x.recYards += Number(row.receiving_yards||0);
  }
  for (const x of by.values()) console.log('STATS', JSON.stringify(x));
}
