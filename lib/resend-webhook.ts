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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResendLifecycleEvent {
  messageId: string;
  recipientEmail: string;
  deliveryToken: string;
  status: string;
  eventAt: string | null;
}

function readDeliveryToken(tags: unknown): string {
  if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
    const value = (tags as Record<string, unknown>).delivery_token;
    return typeof value === 'string' ? value.trim() : '';
  }
  if (Array.isArray(tags)) {
    const match = tags.find((tag) => {
      if (!tag || typeof tag !== 'object') return false;
      return (tag as Record<string, unknown>).name === 'delivery_token';
    }) as Record<string, unknown> | undefined;
    return typeof match?.value === 'string' ? match.value.trim() : '';
  }
  return '';
}

/**
 * Pull only the correlation fields Grudge needs from a Resend lifecycle event.
 *
 * The delivery token is a random per-message capability stored in Postgres and
 * sent as an email tag. Resend echoes tags in webhook payloads, so an external
 * caller cannot alter delivery state unless it knows the token, provider
 * message id, and recipient for the exact recap row.
 */
export function parseResendLifecycleEvent(payload: unknown): ResendLifecycleEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const event = payload as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type.trim().toLowerCase() : '';
  if (!type.startsWith('email.')) return null;

  const status = type.slice('email.'.length);
  if (!SUPPORTED_EMAIL_EVENTS.has(status)) return null;

  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const fields = data as Record<string, unknown>;

  const messageId = typeof fields.email_id === 'string' ? fields.email_id.trim() : '';
  const recipients = Array.isArray(fields.to) ? fields.to : [];
  const recipientEmail = recipients.length === 1 && typeof recipients[0] === 'string'
    ? recipients[0].trim().toLowerCase()
    : '';
  const deliveryToken = readDeliveryToken(fields.tags);

  if (!messageId || !recipientEmail || !UUID_RE.test(deliveryToken)) return null;

  const createdAt = typeof event.created_at === 'string' ? event.created_at.trim() : '';
  const eventAt = createdAt && !Number.isNaN(Date.parse(createdAt)) ? createdAt : null;

  return { messageId, recipientEmail, deliveryToken, status, eventAt };
}
