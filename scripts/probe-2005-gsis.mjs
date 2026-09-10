#!/usr/bin/env node
const recovered = [
  [1868359,'Jake Plummer','QB'],[1921396,'Michael Vick','QB'],[1951644,'Domanick Davis','RB'],
  [1867957,'Kerry Collins','QB'],[1962369,'Carnell Williams','RB'],[1870431,'Sebastian Janikowski','K'],
  [1868405,'Marcus Robinson','WR'],[1869694,'Donovan McNabb','QB'],[1869693,'Ricky Williams','RB'],
  [1869892,'Brandon Stokley','WR'],[1868367,'Priest Holmes','RB'],[1953735,'Nate Burleson','WR'],
  [1868992,'Marshall Faulk','RB'],[1870428,'Bubba Franks','TE'],[2129297,'J.J. Arrington','RB'],
  [2014162,'Eric Johnson','TE'],[1954423,'Doug Jolley','TE'],[1951343,'Jason McAddley','WR'],
];
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
const [ids, stats] = await Promise.all([
  csv('https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'),
  csv('https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2005.csv'),
]);
for (const [espn,name,pos] of recovered) {
  const n=norm(name);
  const statMatches=[...new Map(stats.filter(r=>norm(r.player_display_name)===n && (r.position===pos || (pos==='RB'&&r.position==='FB'))).map(r=>[r.player_id,r])).values()];
  const idMatches=ids.filter(r=>norm(r.name||r.full_name||r.player_name||r.mfl_name||'')===n || norm(r.name||'')===n)
    .filter(r=>!r.position || r.position===pos || (pos==='RB'&&r.position==='FB'));
  console.log(JSON.stringify({espn,name,pos,statMatches:statMatches.map(r=>({gsis:r.player_id,name:r.player_display_name,position:r.position})),idMatches:idMatches.slice(0,5).map(r=>({gsis:r.gsis_id,espn:r.espn_id,name:r.name,position:r.position}))}));
}
