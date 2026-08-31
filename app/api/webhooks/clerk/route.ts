import { verifyWebhook } from '@clerk/nextjs/webhooks';
import type { NextRequest } from 'next/server';

import { profileInputFromClerk } from '../../../../lib/clerk-profile.ts';
import { provisionProfile } from '../../../../lib/provisioner.ts';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request);
  } catch {
    return Response.json({ error: 'Invalid webhook signature.' }, { status: 400 });
  }

  if (event.type !== 'user.created' && event.type !== 'user.updated') {
    return Response.json({ ok: true, ignored: true });
  }

  const input = profileInputFromClerk(event.data);
  if (!input) {
    return Response.json({ error: 'Clerk user has no email address.' }, { status: 422 });
  }

  try {
    await provisionProfile(input.id, input.email, input.displayName);
    return Response.json({ ok: true });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : null;
    if (code === '42501') {
      return Response.json({ error: 'User is not on the active league roster.' }, { status: 403 });
    }
    // Keep connection details and member addresses out of Vercel logs while
    // still returning 5xx so Clerk retries a transient database failure.
    console.error('Clerk profile provisioning failed.', { code });
    return Response.json({ error: 'Profile provisioning failed.' }, { status: 500 });
  }
}
