import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

const SUPPORTED_EMAIL_EVENTS = new Set([
  'sent',
  'scheduled',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'opened',
  'clicked',
  'failed',
  'suppressed',
]);

export interface ResendWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export interface ResendLifecycleEvent {
  messageId: string;
  status: string;
  eventAt: string | null;
}

function signingKey(secret: string): Buffer | null {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  if (!encoded) return null;
  const key = Buffer.from(encoded, 'base64');
  return key.length > 0 ? key : null;
}

/**
 * Verify Resend/Svix webhook signatures without adding a runtime dependency.
 * Svix signs `${id}.${timestamp}.${rawBody}` with HMAC-SHA256 and encodes the
 * digest as base64 in one or more `v1,...` signature entries.
 */
export function verifyResendWebhookSignature(
  payload: string,
  headers: ResendWebhookHeaders,
  secret: string,
  nowMs = Date.now()
): boolean {
  const id = headers.id?.trim();
  const timestamp = headers.timestamp?.trim();
  const signatureHeader = headers.signature?.trim();
  const key = signingKey(secret.trim());
  if (!id || !timestamp || !signatureHeader || !key) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds)) return false;
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds);
  if (ageSeconds > MAX_SIGNATURE_AGE_SECONDS) return false;

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest();

  for (const candidate of signatureHeader.split(/\s+/)) {
    const comma = candidate.indexOf(',');
    if (comma <= 0) continue;
    const version = candidate.slice(0, comma);
    const encoded = candidate.slice(comma + 1);
    if (version !== 'v1' || !encoded) continue;

    const actual = Buffer.from(encoded, 'base64');
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      return true;
    }
  }

  return false;
}

export function parseResendLifecycleEvent(payload: unknown): ResendLifecycleEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const event = payload as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type.trim().toLowerCase() : '';
  if (!type.startsWith('email.')) return null;

  const status = type.slice('email.'.length);
  if (!SUPPORTED_EMAIL_EVENTS.has(status)) return null;

  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const messageIdValue = (data as Record<string, unknown>).email_id;
  const messageId = typeof messageIdValue === 'string' ? messageIdValue.trim() : '';
  if (!messageId) return null;

  const createdAt = typeof event.created_at === 'string' ? event.created_at.trim() : '';
  const eventAt = createdAt && !Number.isNaN(Date.parse(createdAt)) ? createdAt : null;

  return { messageId, status, eventAt };
}
