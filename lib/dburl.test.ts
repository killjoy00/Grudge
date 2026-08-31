/**
 * Tests for connection-string validation.
 *
 * Each malformed case below is a real way to get this wrong by copying the
 * wrong thing out of Neon's dashboard, which offers the same credential in
 * psql, .env and framework flavours. One of them cost three failed builds
 * before the driver's own error ("Database connection string format for
 * `neon()` should be: ***host.tld/dbname?option=value", raised from inside a
 * prerender, with the value masked and the variable unnamed) was decoded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeUrlProblem } from './dburl.ts';

const GOOD = 'postgresql://user:pw@ep-example-123.us-east-1.aws.neon.tech/neondb?sslmode=require';

test('a well-formed Neon URL is accepted', () => {
  assert.equal(describeUrlProblem(GOOD), null);
  assert.equal(describeUrlProblem(`  ${GOOD}  `), null, 'surrounding whitespace is tolerated');
  assert.equal(describeUrlProblem(GOOD.replace('postgresql:', 'postgres:')), null,
    'the postgres:// scheme is also valid');
});

test('each real-world mistake is named specifically', () => {
  const cases: [string, RegExp][] = [
    ['', /empty/],
    ['   ', /empty/],
    [`"${GOOD}"`, /quotes/],
    [`'${GOOD}'`, /quotes/],
    [`psql ${GOOD}`, /psql/],
    [`APP_DATABASE_URL=${GOOD}`, /NAME=|equals/],
    ['not-a-url-at-all', /not a URL|postgresql/],
    ['mysql://user:pw@host/db', /scheme/],
    ['postgresql://user:pw@ep-example.neon.tech', /no database|names no database/],
  ];
  for (const [input, expected] of cases) {
    const problem = describeUrlProblem(input);
    assert.ok(problem, `should have rejected: ${input.slice(0, 30)}`);
    assert.match(problem, expected);
  }
});

test('the message never echoes the connection string', () => {
  // It carries a password, and this text lands in build logs that are read far
  // more widely than the secret store the value came from.
  const secret = 'postgresql://admin:hunter2@ep-secret.neon.tech/neondb';
  for (const bad of [`"${secret}"`, `psql ${secret}`, `APP_DATABASE_URL=${secret}`]) {
    const problem = describeUrlProblem(bad)!;
    assert.ok(!problem.includes('hunter2'), 'must not leak the password');
    assert.ok(!problem.includes('ep-secret'), 'must not leak the host');
  }
});
