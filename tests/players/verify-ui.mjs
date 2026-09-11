import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const output='test-results/players'; mkdirSync(output,{recursive:true});
const env={...process.env,VERCEL_ENV:'preview',APP_DATABASE_URL:'postgresql://app_user:fixture@player-fixture.invalid/neondb'};
delete env.CLERK_SECRET_KEY; delete env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const server=spawn(process.execPath,['--import','tsx','--import','./tests/players/fixture-database.mjs',
  'node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3018'],{env,stdio:['ignore','pipe','pipe']});
let log=''; server.stdout.on('data',d=>{log+=d}); server.stderr.on('data',d=>{log+=d});
let browser;
try {
  for(let i=0;i<240&&!log.includes('Ready');i++) await new Promise(r=>setTimeout(r,250));
  assert.ok(log.includes('Ready'),'Fixture server did not become ready: '+log);
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3018/players',{waitUntil:'networkidle'});
  assert.match(await page.locator('h2').first().innerText(),/All players/i);
  await page.getByRole('combobox',{name:'Season',exact:true}).selectOption('2024');
  await page.getByRole('combobox',{name:'Position',exact:true}).selectOption('WR');
  await page.getByRole('combobox',{name:'From week',exact:true}).selectOption('3');
  await page.getByRole('combobox',{name:'Through week',exact:true}).selectOption('6');
  await page.getByRole('button',{name:'Show players',exact:true}).click();
  await page.waitForLoadState('networkidle');
  const first=page.locator('.player-table tbody tr').first();
  assert.match(await first.innerText(),/Chase/); assert.match(await first.innerText(),/92\.80/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'Mobile page must not overflow');
  await page.screenshot({path:`${output}/players-mobile.png`,fullPage:true});
  await first.getByRole('link').click(); await page.waitForLoadState('networkidle');
  assert.match(await page.locator('h1').innerText(),/Chase/);
  assert.equal(await page.locator('.player-game-table tbody tr').count(),4,'Profile preserves selected weeks');
  await page.screenshot({path:`${output}/profile-mobile.png`,fullPage:true});
  await page.goto('http://127.0.0.1:3018/players/espn/3139477?season=2024',{waitUntil:'networkidle'});
  const history=await page.locator('.player-timeline').innerText();
  assert.match(history,/Michael Chepul/); assert.match(history,/Jonathan Crisp/);
  await page.getByRole('combobox',{name:'Schedule',exact:true}).selectOption('POST');
  await page.getByRole('button',{name:'Show season',exact:true}).click(); await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('.player-game-table tbody tr').count(),3);
  await page.goto('http://127.0.0.1:3018/players?season=2005&q=Tomlinson',{waitUntil:'networkidle'});
  assert.match(await page.locator('.player-table').innerText(),/LaDainian Tomlinson/);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:3018/players?season=2025&position=QB',{waitUntil:'networkidle'});
  await page.screenshot({path:`${output}/players-desktop.png`,fullPage:true});
  assert.deepEqual(errors,[],'Browser page errors');
  console.log('PASS: mobile filters, historical score, profiles, correct managers, NFL playoffs, 2005, desktop, no page errors');
} finally {
  if(browser) await browser.close();
  server.kill('SIGTERM');
  writeFileSync(`${output}/server.log`,log);
}
