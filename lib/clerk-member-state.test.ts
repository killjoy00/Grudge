import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeClerkMembers } from './clerk-member-state.ts';

test('registered Clerk users take precedence over one-time invitation history', () => {
  const result = summarizeClerkMembers(
    ['Member@Example.com'],
    [{ emailAddress: 'member@example.com', status: 'pending' }],
    [{
      id: 'user_123',
      fullName: 'League Member',
      username: null,
      emailAddresses: [{ emailAddress: 'MEMBER@example.com' }],
    }]
  );

  assert.deepEqual(result.get('member@example.com'), {
    state: 'registered',
    userId: 'user_123',
    displayName: 'League Member',
  });
});

test('pending, expired, and missing invitations stay distinct', () => {
  const result = summarizeClerkMembers(
    ['pending@example.com', 'expired@example.com', 'missing@example.com'],
    [
      { emailAddress: 'pending@example.com', status: 'pending' },
      { emailAddress: 'expired@example.com', status: 'expired' },
    ],
    []
  );

  assert.equal(result.get('pending@example.com')?.state, 'invited');
  assert.equal(result.get('expired@example.com')?.state, 'expired');
  assert.equal(result.get('missing@example.com')?.state, 'missing');
});

test('partial email matches from Clerk never attach to the wrong roster member', () => {
  const result = summarizeClerkMembers(
    ['ann@example.com'],
    [{ emailAddress: 'joann@example.com', status: 'pending' }],
    [{
      id: 'user_wrong',
      fullName: null,
      username: 'joann',
      emailAddresses: [{ emailAddress: 'joann@example.com' }],
    }]
  );

  assert.equal(result.get('ann@example.com')?.state, 'missing');
});
