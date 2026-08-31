import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';

export interface ClerkAllowlistEntry {
  id: string;
  identifier: string;
}

/** Server-only view of Clerk's sign-up allowlist. */
export async function getClerkAllowlist(): Promise<ClerkAllowlistEntry[]> {
  const client = await clerkClient();
  const result = await client.allowlistIdentifiers.getAllowlistIdentifierList({ limit: 500 });
  return result.data.map((entry) => ({
    id: entry.id,
    identifier: entry.identifier,
  }));
}

/** Make one email match the database membership state. Safe to retry. */
export async function syncClerkAllowlist(
  email: string,
  active: boolean,
  notify = false
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const client = await clerkClient();
  const entries = await client.allowlistIdentifiers.getAllowlistIdentifierList({ limit: 500 });
  const matches = entries.data.filter(
    (entry) => entry.identifier.toLowerCase() === normalized
  );

  if (active && matches.length === 0) {
    await client.allowlistIdentifiers.createAllowlistIdentifier({
      identifier: normalized,
      notify,
    });
    return;
  }

  if (!active) {
    await Promise.all(
      matches.map((entry) =>
        client.allowlistIdentifiers.deleteAllowlistIdentifier(entry.id)
      )
    );
  }
}
