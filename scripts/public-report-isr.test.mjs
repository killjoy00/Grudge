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
