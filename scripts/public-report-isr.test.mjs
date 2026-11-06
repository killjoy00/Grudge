import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config as middlewareConfig } from '../middleware.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const WEEK = 'export const revalidate = 604800;';

const publicRoutes = [
  'app/scoreboard/[edition]/page.tsx',
  'app/standings/recaps/[season]/[week]/page.tsx',
  'app/standings/season/[year]/page.tsx',
  'app/rankings/season/[year]/page.tsx',
  'app/history/range/[years]/page.tsx',
  'app/history/[season]/page.tsx',
  'app/history/records/[edition]/page.tsx',
  'app/history/drafts/[edition]/page.tsx',
  'app/history/vault/weekly/[edition]/page.tsx',
  'app/history/vault/[season]/page.tsx',
  'app/players/records/[edition]/page.tsx',
  'app/team/[id]/page.tsx',
  'app/manager/[key]/page.tsx',
  'app/franchise/[key]/page.tsx',
];

test('public scoreboard and report pages use week-long ISR', () => {
  for (const path of publicRoutes) {
    const file = read(path);
    assert.ok(file.includes(WEEK), path + ' must use one-week ISR');
    assert.ok(!file.includes("force-dynamic"), path + ' should not render every request');
    assert.ok(!file.includes('auth('), path + ' should not read session in ISR');
  }
  const onDemand = [
    'app/scoreboard/[edition]/page.tsx',
    'app/standings/recaps/[season]/[week]/page.tsx',
    'app/standings/season/[year]/page.tsx',
    'app/rankings/season/[year]/page.tsx',
    'app/history/range/[years]/page.tsx',
    'app/history/records/[edition]/page.tsx',
    'app/history/drafts/[edition]/page.tsx',
    'app/history/vault/weekly/[edition]/page.tsx',
    'app/history/vault/[season]/page.tsx',
    'app/players/records/[edition]/page.tsx',
  ];
  for (const path of onDemand) {
    const code = read(path);
    assert.ok(code.includes('generateStaticParams()'), path + ' should not need a DB during build');
    assert.ok(code.includes('return [];'), path + ' must render on demand');
  }
});

test('weekly public data does not refetch every minute or hour', () => {
  const cachePaths = [
    'lib/cached-queries.ts',
    'lib/history-cache.ts',
    'lib/history-overview-cache.ts',
    'lib/regular-season-history.ts',
    'lib/trade-production-queries.ts',
    'lib/draft-slot-records.ts',
    'lib/draft-records.ts',
    'lib/weekly-recaps.ts',
  ];
  for (const path of cachePaths) {
    const c = read(path);
    assert.ok(!c.includes('revalidate: 120'), path);
    assert.ok(!c.includes('revalidate: 300'), path);
    assert.ok(!c.includes('revalidate: 3600'), path);
    assert.ok(!c.includes('revalidate: 86400'), path);
  }
  const home = read('app/scoreboard/[edition]/page.tsx');
  assert.ok(home.includes('getPublicHomeData = unstable_cache'));
  assert.ok(home.includes('revalidate: 604800'));
});

test('existing links preserve access to cached routes', () => {
  assert.ok(read('app/page.tsx').includes('/scoreboard/current'));
  assert.ok(read('app/standings/page.tsx').includes('/standings/season/'));
  assert.ok(read('app/rankings/page.tsx').includes('/rankings/season/'));
  assert.ok(read('app/history/page.tsx').includes('/history/range/'));
  assert.ok(read('app/history/range/[years]/page.tsx').includes('action="/history"'));
  assert.ok(read('components/Nav.tsx').includes("path.startsWith('/scoreboard/')"));
  for (const path of [
    'app/history/records/page.tsx',
    'app/history/drafts/page.tsx',
    'app/players/records/page.tsx',
  ]) {
    assert.ok(read(path).includes('/weekly'), path);
  }
  assert.ok(read('app/history/vault/page.tsx').includes('/weekly/current'));
});

test('public weekly pages no longer expose comments or signed-in data', () => {
  const home = read('app/scoreboard/[edition]/page.tsx');
  assert.ok(!home.includes('kind="comments"'));
  assert.ok(!home.includes('auth('));
  assert.ok(home.includes('<HomeMemberPanel season='));

  const recap = read('app/standings/recaps/[season]/[week]/page.tsx');
  assert.ok(!recap.includes('auth('));
  assert.ok(!recap.includes('getComments'));
  assert.ok(!recap.includes('Comments'));

  const route = read('app/api/home-member/route.ts');
  assert.ok(route.includes('await auth()'));
  assert.ok(route.includes('if (!userId)'));
  assert.ok(route.includes('getLockedWeekPicks('));
  assert.ok(route.includes("kind !== 'picks'"));
  assert.ok(!route.includes('getComments('));
  assert.ok(route.includes('private, no-store'));

  const client = read('components/HomeMemberPanel.tsx');
  assert.ok(client.includes('useUser()'));
  assert.ok(client.includes('isSignedIn'));
  assert.ok(client.includes("cache: 'no-store'"));
  assert.ok(!client.includes('Comments'));
  for (const method of ['postComment', 'editComment', 'deleteComment']) {
    assert.ok(!read('lib/actions.ts').includes(method));
  }
  assert.ok(!read('lib/queries.ts').includes('getComments('));
  assert.ok(read('app/predictions/page.tsx').includes("force-dynamic"));
});

test('private league is opted out of polite search indexing', () => {
  assert.ok(read('app/robots.ts').includes("userAgent: '*'"));
  assert.ok(read('app/robots.ts').includes("disallow: '/'"));
});

function middlewareMatches(path) {
  return unstable_doesMiddlewareMatch({
    config: middlewareConfig,
    nextConfig: {},
    url: `https://grudge.planitnow.us${path}`,
  });
}

test('Clerk middleware skips public reports, assets, and signed webhooks', () => {
  for (const path of [
    '/', '/scoreboard/current', '/standings', '/standings/season/current',
    '/standings/recaps/2026/8', '/rankings', '/rankings/season/current',
    '/history', '/history/2026', '/history/records/weekly',
    '/history/drafts/weekly', '/history/rivalries', '/team/10',
    '/manager/ryan-mindell', '/franchise/cte-deniers',
    '/players', '/players/records/weekly', '/matchup/2026/8/1',
    '/grudge/manager-a/manager-b', '/api/health',
    '/api/webhooks/clerk', '/api/webhooks/resend', '/preview',
    '/_next/static/chunk.js',
  ]) {
    assert.equal(middlewareMatches(path), false, `public path invoked Clerk: ${path}`);
  }
});

test('Clerk middleware continues to guard private pages and APIs', () => {
  for (const path of [
    '/predictions', '/predictions?season=2026', '/me', '/me?team=10',
    '/admin', '/admin/status', '/admin/members', '/admin/recaps',
    '/admin/pool', '/admin/trades', '/trades', '/trades?season=2026',
    '/api/home-member?kind=picks&season=2026&week=8',
    '/api/admin/pool', '/api/admin/allowlist', '/__clerk/frontend',
  ]) {
    assert.equal(middlewareMatches(path), true, `private path skipped Clerk: ${path}`);
  }
});

test('Clerk-free preview still redirects root to preview', () => {
  assert.ok(read('app/page.tsx').includes("previewWithoutClerk() ? '/preview' : '/scoreboard/current'"));
});
