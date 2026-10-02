import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  parseResendLifecycleEvent,
  verifyResendWebhookSignature,
} from './resend-webhook.ts';

function signedHeaders(payload: string, secret: string, timestamp: number) {
  const id = 'msg_test_webhook';
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  return {
    id,
    timestamp: String(timestamp),
    signature: `v1,${signature}`,
  };
}

test('verifies a current Svix signature over the untouched request body', () => {
  const now = Date.UTC(2026, 8, 15, 18, 30, 0);
  const timestamp = Math.floor(now / 1000);
  const secret = `whsec_${Buffer.from('grudge-webhook-test-secret-32-bytes').toString('base64')}`;
  const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'email_123' } });

  assert.equal(
    verifyResendWebhookSignature(payload, signedHeaders(payload, secret, timestamp), secret, now),
    true
  );
  assert.equal(
    verifyResendWebhookSignature(`${payload} `, signedHeaders(payload, secret, timestamp), secret, now),
    false
  );
});

test('rejects stale webhook signatures', () => {
  const now = Date.UTC(2026, 8, 15, 18, 30, 0);
  const timestamp = Math.floor(now / 1000) - 301;
  const secret = `whsec_${Buffer.from('grudge-webhook-test-secret-32-bytes').toString('base64')}`;
  const payload = '{}';

  assert.equal(
    verifyResendWebhookSignature(payload, signedHeaders(payload, secret, timestamp), secret, now),
    false
  );
});

test('parses supported email lifecycle events without retaining recipient data', () => {
  assert.deepEqual(
    parseResendLifecycleEvent({
      type: 'email.delivered',
      created_at: '2026-09-15T18:30:00.000Z',
      data: {
        email_id: 'email_123',
        to: ['member@example.com'],
        subject: 'ignored',
      },
    }),
    {
      messageId: 'email_123',
      status: 'delivered',
      eventAt: '2026-09-15T18:30:00.000Z',
    }
  );
});

test('ignores non-email and malformed events', () => {
  assert.equal(parseResendLifecycleEvent({ type: 'contact.updated', data: {} }), null);
  assert.equal(parseResendLifecycleEvent({ type: 'email.delivered', data: {} }), null);
});
