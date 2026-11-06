import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('public standings and history are on-demand ISR routes, not per-request SSR', () => {
  const standings = read('app/standings/season/[year]/page.tsx');
  const history = read('app/history/range/[years]/page.tsx');
  assert.match(standings, /export const revalidate = 86400;/);
  assert.match(history, /export const revalidate = 604800;/);
  for (const page of [standings, history]) {
    assert.match(page, /generateStaticParams\(\).*return \[\]/s);
    assert.doesNotMatch(page, /force-dynamic|searchParams|\bauth\(/);
  }
});

test('legacy query filters redirect to ISR paths and navigation uses those paths', () => {
  assert.match(read('app/standings/page.tsx'), /searchParams/);
  assert.match(read('app/standings/page.tsx'), /standings\/season/);
  assert.match(read('app/history/page.tsx'), /history\/range/);
  assert.match(read('app/history/range/[years]/page.tsx'), /action="\/history"/);
  assert.match(read('components/SeasonPicker.tsx'), /pathStyle === 'segment'/);
  const nav = read('components/Nav.tsx');
  assert.match(nav, /\/standings\/season\/current/);
  assert.match(nav, /\/history\/range\/all/);
});

test('power rankings serve on-demand cached season reports and keep old links working', () => {
  const ranking = read('app/rankings/season/[year]/page.tsx');
  assert.match(ranking, /export const revalidate = 3600;/);
  assert.match(ranking, /generateStaticParams\(\).*return \[\]/s);
  assert.doesNotMatch(ranking, /force-dynamic|searchParams|\bauth\(/);
  assert.match(ranking, /pathStyle="segment"/);
  const legacy = read('app/rankings/page.tsx');
  assert.match(legacy, /searchParams/);
  assert.match(legacy, /rankings\/season/);
  assert.doesNotMatch(legacy, /getCachedPowerRankings|\bauth\(/);
});

test('shared home caches only public data; personalized comments and picks remain live', () => {
  const home = read('app/page.tsx');
  assert.match(home, /const getPublicHomeData = unstable_cache/);
  assert.match(home, /revalidate: 120/);
  const publicSection = home.split('const getPublicHomeData = unstable_cache(')[1].split('const getCachedWeekMatchups')[0];
  assert.doesNotMatch(publicSection, /getComments|getLockedWeekPicks|\bauth\(/);
  assert.match(home, /userId \? getComments\(season, week\)/);
  assert.match(home, /userId && locked/);
});

test('private Grudge league excludes crawlers via a static robots route', () => {
  const robots = read('app/robots.ts');
  assert.match(robots, /userAgent: '\*', disallow: '\/'/);
});
