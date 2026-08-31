import { test } from 'node:test';
import assert from 'node:assert/strict';

import { profileInputFromClerk, type ClerkUserPayload } from './clerk-profile.ts';

function user(overrides: Partial<ClerkUserPayload> = {}): ClerkUserPayload {
  return {
    id: 'user_123',
    primary_email_address_id: 'email_primary',
    email_addresses: [
      { id: 'email_other', email_address: 'other@example.com' },
      { id: 'email_primary', email_address: ' Ryan@Example.com ' },
    ],
    first_name: 'Ryan',
    last_name: 'Mindell',
    username: null,
    ...overrides,
  };
}

test('Clerk provisioning uses the primary email and a clean full name', () => {
  assert.deepEqual(profileInputFromClerk(user()), {
    id: 'user_123',
    email: 'ryan@example.com',
    displayName: 'Ryan Mindell',
  });
});

test('Clerk provisioning falls back to the first email and username', () => {
  assert.deepEqual(profileInputFromClerk(user({
    primary_email_address_id: null,
    email_addresses: [{ id: 'email_1', email_address: 'member@example.com' }],
    first_name: null,
    last_name: null,
    username: 'member',
  })), {
    id: 'user_123',
    email: 'member@example.com',
    displayName: 'member',
  });
});

test('Clerk provisioning refuses a payload without an email', () => {
  assert.equal(profileInputFromClerk(user({ email_addresses: [] })), null);
});
