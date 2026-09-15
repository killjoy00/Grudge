import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessProviderDelivery,
  classifyProviderStatus,
  normalizeProviderStatus,
  type ProviderObservation,
} from './reconcile-recap-provider.ts';

function obs(
  providerStatus: string | null,
  overrides: Partial<ProviderObservation> = {}
): ProviderObservation {
  return {
    providerStatus,
    hasMessageId: true,
    lookupError: null,
    ...overrides,
  };
}

test('provider statuses that prove mailbox delivery count as delivered', () => {
  assert.equal(classifyProviderStatus('delivered'), 'delivered');
  assert.equal(classifyProviderStatus('opened'), 'delivered');
  assert.equal(classifyProviderStatus('clicked'), 'delivered');
});

test('provider terminal failures remain failures even though Resend accepted the send', () => {
  for (const status of ['bounced', 'complained', 'failed', 'suppressed']) {
    assert.equal(classifyProviderStatus(status), 'failed');
  }
});

test('sent and delivery-delayed states remain pending until mailbox delivery is proven', () => {
  assert.equal(classifyProviderStatus('sent'), 'pending');
  assert.equal(classifyProviderStatus('delivery_delayed'), 'pending');
  assert.equal(classifyProviderStatus('queued'), 'pending');
});

test('provider status normalization is safe for logs and database fields', () => {
  assert.equal(normalizeProviderStatus(' Delivery Delayed '), 'delivery_delayed');
  assert.equal(normalizeProviderStatus(undefined), 'unknown');
});

test('assessment requires every eligible recipient to be confirmed delivered', () => {
  const assessment = assessProviderDelivery([
    obs('delivered'),
    obs('opened'),
    obs('clicked'),
  ]);
  assert.deepEqual(assessment, {
    total: 3,
    delivered: 3,
    failed: 0,
    pending: 0,
    lookupErrors: 0,
    missingMessageIds: 0,
    complete: true,
  });
});

test('assessment separately reports pending, provider failures, lookups, and missing ids', () => {
  const assessment = assessProviderDelivery([
    obs('sent'),
    obs('bounced'),
    obs(null, { lookupError: 'resend_lookup_500_unknown_error' }),
    obs(null, { hasMessageId: false }),
  ]);
  assert.equal(assessment.delivered, 0);
  assert.equal(assessment.pending, 1);
  assert.equal(assessment.failed, 1);
  assert.equal(assessment.lookupErrors, 1);
  assert.equal(assessment.missingMessageIds, 1);
  assert.equal(assessment.complete, false);
});
