import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { neon } from '@neondatabase/serverless';
import type { NextRequest } from 'next/server';

import { profileInputFromClerk } from '../../../../lib/clerk-profile.ts';
import { describeUrlProblem } from '../../../../lib/dburl.ts';

export const runtime = 'nodejs';

let cached: ReturnType<typeof neon> | null = null;

function provisionerClient() {
  if (cached) return cached;
  const raw = process.env.PROVISIONER_DATABASE_URL;
  if (!raw) throw new Error('PROVISIONER_DATABASE_URL is not set.');
  const problem = describeUrlProblem(raw);
  if (problem) throw new Error(`PROVISIONER_DATABASE_URL is malformed: ${problem}.`);

  const parsed = new URL(raw.trim());
  if (decodeURIComponent(parsed.username) !== 'app_provisioner') {
    throw new Error('PROVISIONER_DATABASE_URL must use the app_provisioner role.');
  }
  cached = neon(raw.trim());
  return cached;
}

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
    const sql = provisionerClient() as unknown as {
      query: (text: string, params: unknown[]) => Promise<unknown>;
    };
    await sql.query(
      'select public.provision_profile($1, $2::citext, $3)',
      [input.id, input.email, input.displayName]
    );
    return Response.json({ ok: true });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : null;
    if (code === '42501') {
      return Response.json({ error: 'User is not on the league allowlist.' }, { status: 403 });
    }
    // Keep connection details and member addresses out of Vercel logs while
    // still returning 5xx so Clerk retries a transient database failure.
    console.error('Clerk profile provisioning failed.', { code });
    return Response.json({ error: 'Profile provisioning failed.' }, { status: 500 });
  }
}
