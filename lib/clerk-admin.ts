import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';
import {
  MISSING_CLERK_MEMBER,
  normalizeMemberEmail,
  summarizeClerkMembers,
  type ClerkMember,
} from './clerk-member-state.ts';

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

/**
 * Read Clerk registration/invitation state for the database roster.
 *
 * Clerk's production allowlist is a paid feature. Grudge instead uses the
 * free Invite-only access mode and application invitations. A registered user
 * no longer needs an invitation, so the two resources must be viewed together.
 */
export async function getClerkMembers(emails: string[]): Promise<Map<string, ClerkMember>> {
  const wanted = [...new Set(emails.map(normalizeMemberEmail).filter(Boolean))];
  if (wanted.length === 0) return new Map();

  const client = await clerkClient();
  const [userPages, invitations] = await Promise.all([
    Promise.all(
      chunks(wanted, 100).map((emailAddress) =>
        client.users.getUserList({ emailAddress, limit: 100 })
      )
    ),
    client.invitations.getInvitationList({ limit: 500, orderBy: '-created_at' }),
  ]);

  return summarizeClerkMembers(
    wanted,
    invitations.data,
    userPages.flatMap((page) => page.data)
  );
}

/**
 * Reconcile one database membership with Clerk's free invitation flow.
 *
 * Active registered users need no invitation. Active unregistered users get
 * exactly one pending invitation. Deactivation revokes every pending link;
 * the database membership gate separately blocks already-registered users.
 */
export async function syncClerkMember(
  emailValue: string,
  active: boolean,
  notify = true
): Promise<ClerkMember> {
  const email = normalizeMemberEmail(emailValue);
  const client = await clerkClient();
  const state = (await getClerkMembers([email])).get(email) ?? MISSING_CLERK_MEMBER;

  if (!active) {
    const invitations = await client.invitations.getInvitationList({
      query: email,
      limit: 100,
      orderBy: '-created_at',
    });
    const pending = invitations.data.filter(
      (entry) => normalizeMemberEmail(entry.emailAddress) === email && entry.status === 'pending'
    );
    await Promise.all(pending.map((entry) => client.invitations.revokeInvitation(entry.id)));
    return state;
  }

  if (state.state === 'registered' || state.state === 'invited') return state;

  await client.invitations.createInvitation({
    emailAddress: email,
    notify,
    // An expired invitation may still be present. We have already ruled out a
    // registered user and a pending invitation, so replacing it is safe.
    ignoreExisting: true,
  });
  return { state: 'invited', userId: null, displayName: null };
}
