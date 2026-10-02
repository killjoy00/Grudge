import { NextRequest, NextResponse } from 'next/server';

import { asPublic } from '../../../../lib/db.ts';
import {
  parseResendLifecycleEvent,
  verifyResendWebhookSignature,
} from '../../../../lib/resend-webhook.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SecretRow {
  secret: string | null;
}

interface RecordedRow {
  recorded: boolean;
}

async function webhookSecret(): Promise<string | null> {
  const rows = await asPublic<SecretRow>(
    `select public.provider_webhook_secret('resend') as secret`
  );
  return rows[0]?.secret?.trim() || null;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let secret: string | null;
  try {
    secret = await webhookSecret();
  } catch (error) {
    console.error('Resend webhook secret lookup failed', error);
    return new NextResponse('Webhook unavailable', { status: 503 });
  }
  if (!secret) {
    console.error('Resend webhook secret is not configured');
    return new NextResponse('Webhook unavailable', { status: 503 });
  }

  const verified = verifyResendWebhookSignature(
    rawBody,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    secret
  );
  if (!verified) {
    return new NextResponse('Invalid webhook', { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }

  const event = parseResendLifecycleEvent(payload);
  if (!event) return new NextResponse(null, { status: 204 });

  try {
    const rows = await asPublic<RecordedRow>(
      `select public.record_recap_provider_event($1, $2, $3::timestamptz) as recorded`,
      [event.messageId, event.status, event.eventAt]
    );
    if (!rows[0]?.recorded) {
      console.info(`Ignored Resend ${event.status} event for a non-recap message.`);
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(`Failed to record Resend ${event.status} event`, error);
    return new NextResponse('Webhook unavailable', { status: 503 });
  }
}
