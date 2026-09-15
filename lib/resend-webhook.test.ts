import assert from 'node:assert/strict';
import test from 'node:test';

import { parseResendLifecycleEvent } from './resend-webhook.ts';

const TOKEN = '5d856381-bb1b-4e68-b6d4-dfbf64b5ae4e';

test('parses a tagged single-recipient delivery event', () => {
  assert.deepEqual(
    parseResendLifecycleEvent({
      type: 'email.delivered',
      created_at: '2026-09-15T18:30:00.000Z',
      data: {
        email_id: 'email_123',
        to: ['Member@Example.com'],
        tags: { kind: 'weekly-recap', delivery_token: TOKEN },
      },
    }),
    {
      messageId: 'email_123',
      recipientEmail: 'member@example.com',
      deliveryToken: TOKEN,
      status: 'delivered',
      eventAt: '2026-09-15T18:30:00.000Z',
    }
  );
});

test('accepts the array tag shape defensively', () => {
  const event = parseResendLifecycleEvent({
    type: 'email.bounced',
    data: {
      email_id: 'email_456',
      to: ['member@example.com'],
      tags: [{ name: 'delivery_token', value: TOKEN }],
    },
  });
  assert.equal(event?.status, 'bounced');
  assert.equal(event?.deliveryToken, TOKEN);
});

test('rejects events that cannot prove correlation to one recap delivery', () => {
  assert.equal(parseResendLifecycleEvent({ type: 'contact.updated', data: {} }), null);
  assert.equal(parseResendLifecycleEvent({
    type: 'email.delivered',
    data: { email_id: 'email_123', to: ['member@example.com'], tags: {} },
  }), null);
  assert.equal(parseResendLifecycleEvent({
    type: 'email.delivered',
    data: {
      email_id: 'email_123',
      to: ['a@example.com', 'b@example.com'],
      tags: { delivery_token: TOKEN },
    },
  }), null);
});
