import 'server-only';

import { neon } from '@neondatabase/serverless';
import { describeUrlProblem } from './dburl.ts';

let cached: ReturnType<typeof neon> | null = null;

function client() {
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

function query(text: string, params: unknown[]) {
  return (client() as unknown as {
    query: (sql: string, values: unknown[]) => Promise<unknown>;
  }).query(text, params);
}

export function provisionProfile(id: string, email: string, displayName: string | null) {
  return query(
    'select public.provision_profile($1, $2::citext, $3)',
    [id, email, displayName]
  );
}

export function syncProfileMembership(email: string) {
  return query('select public.sync_profile_membership($1::citext)', [email]);
}
