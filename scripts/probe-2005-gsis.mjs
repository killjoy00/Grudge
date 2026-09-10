#!/usr/bin/env node
function norm(s) { return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z0-9]+/g,''); }
function parseCsv(text) {
  const rows=[]; let row=[], field='', q=false;
  for (let i=0;i<text.length;i++) { const c=text[i];
    if(q){ if(c==='"'&&text[i+1]==='"'){field+='"';i++;} else if(c==='"')q=false; else field+=c; }
    else if(c==='"')q=true; else if(c===','){row.push(field);field='';} else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';} else field+=c;
  }
  const h=rows.shift()??[]; return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((x,i)=>[x,r[i]??''])));
}
async function csv(url){ const r=await fetch(url,{headers:{'user-agent':'Grudge historical identity audit'}}); if(!r.ok)throw new Error(`${url} ${r.status}`); return parseCsv(await r.text()); }

for (const year of [2003,2004,2005,2006,2007]) {
  const stats = await csv(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`);
  const candidates = [...new Map(stats.filter((r) => {
    const n = norm(r.player_display_name);
    return (r.position === 'RB' && (n.includes('domanick') || n === 'domdavis' || n === 'domanickwilliams'))
      || (r.position === 'TE' && n === 'ericjohnson');
  }).map((r) => [r.player_id, r])).values()];
  for (const row of candidates) console.log(JSON.stringify({year,gsis:row.player_id,name:row.player_display_name,position:row.position}));
}
