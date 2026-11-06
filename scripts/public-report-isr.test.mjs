import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const WEEK = 'export const revalidate = 604800;';

test('public scoreboard and report routes use full weekly ISR, never per-request rendering', () => {
  const routes = [
    'app/scoreboard/[edition]/page.tsx',
    'app/standings/season/[year]/page.tsx',
    'app/rankings/season/[year]/page.tsx',
    'app/history/range/[years]/page.tsx',
    'app/history/[season]/page.tsx',
    'app/history/records/[edition]/page.tsx',
    'app/history/drafts/[edition]/page.tsx',
    'app/history/vault/[edition]/page.tsx',
    'app/players/records/[edition]/page.tsx',
    'app/team/[id]/page.tsx',
    'app/manager/[key]/page.tsx',
    'app/franchise/[key]/page.tsx',
  ];
  for (const path of routes) {
    const source = read(path);
    assert.ok(source.includes(WEEK), `${path} must use weekly ISR`);
    assert.doesNotMatch(source, /force-dynamic|\\bauth\\(/, `${path} must not be session-rendered`);
  }
  for (const path of routes.filter(p => p.includes('[edition]') ||
      p.includes('standings/season') || p.includes('rankings/season') ||
      p.includes('history/range'))) {
    assert.match(read(path), /generateStaticParams\\(\\).*return \\[\\]/s, `${path} must skip build-time DB queries`);
  }
});

test('public query caches use weekly TTL rather than minute-level invalidation', () => {
  const paths = [
    'lib/cached-queries.ts', 'lib/history-cache.ts',
    'lib/history-overview-cache.ts', 'lib/regular-season-history.ts',
    'lib/trade-production-queries.ts', 'lib/draft-slot-records.ts',
    'lib/draft-records.ts', 'lib/weekly-recaps.ts',
  ];
  for (const path of paths) {
    const source = read(path);
    assert.doesNotMatch(source, /revalidate:\\s*(120|300|3600|86400)\\b/, path);
  }
  const home = read('app/scoreboard/[edition]/page.tsx');
  assert.match(home, /revalidate: 604800/);
  assert.match(home, /getPublicHomeData = unstable_cache/);
  assert.doesNotMatch(home, /getComments|getLockedWeekPicks|\\bauth\\(/);
  assert.match(home, /HomeMemberPanel/);
});

test('legacy URLs still reach the weekly cached pages', () => {
  assert.match(read('app/page.tsx'), /scoreboard\\/current/);
  assert.match(read('app/standings/page.tsx'), /standings\\/season/);
  assert.match(read('app/rankings/page.tsx'), /rankings\\/season/);
  assert.match(read('app/history/page.tsx'), /history\\/range/);
  assert.match(read('app/history/range/[years]/page.tsx'), /action="\\/history"/);
  assert.match(read('components/Nav.tsx'), /path.startsWith\\('\\/scoreboard\\/'\\)/);
  assert.match(read('components/Nav.tsx'), /\\/standings\\/season\\/current/);
  for (const path of [
    'app/history/records/page.tsx',
    'app/history/drafts/page.tsx',
    'app/history/vault/page.tsx',
    'app/players/records/page.tsx',
  ]) {
    assert.match(read(path), /redirect\\('\\/.*\\/weekly'\\)/);
  }
});

test('member-only comments and locked picks cannot leak into weekly HTML', () => {
  const home = read('app/scoreboard/[edition]/page.tsx');
  assert.doesNotMatch(home, /getComments|getLockedWeekPicks|\\bauth\\(/);
  assert.match(home, /kind="comments"/);
  assert.match(home, /kind="picks"/);
  const memberRoute = read('app/api/home-member/route.ts');
  assert.match(memberRoute, /const \\{ userId \\} = await auth\\(\\)/);
  assert.match(memberRoute, /if \\(!userId\\) return Response.json/);
  assert.match(memberRoute, /getLockedWeekPicks/);
  assert.match(memberRoute, /getComments/);
  assert.match(memberRoute, /Cache-Control': 'private, no-store'/);
  const client = read('components/HomeMemberPanel.tsx');
  assert.match(client, /useUser\\(\\)/);
  assert.match(client, /if \\(!isLoaded \\|\\| !isSignedIn/);
  assert.match(client, /cache: 'no-store'/);
  assert.match(read('app/predictions/page.tsx'), /force-dynamic/);
});

test('the private Grudge league discourages search indexing', () => {
  assert.match(read('app/robots.ts'), /userAgent: '\\*', disallow: '\\/'/);
});
