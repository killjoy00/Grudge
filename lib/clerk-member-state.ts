export type ClerkMemberState = 'registered' | 'invited' | 'expired' | 'missing';

export interface ClerkMember {
  state: ClerkMemberState;
  userId: string | null;
  displayName: string | null;
}

export interface ClerkInvitationSummary {
  emailAddress: string;
  status: string;
}

export interface ClerkUserSummary {
  id: string;
  fullName: string | null;
  username: string | null;
  emailAddresses: Array<{ emailAddress: string }>;
}

export const MISSING_CLERK_MEMBER: ClerkMember = {
  state: 'missing',
  userId: null,
  displayName: null,
};

export function normalizeMemberEmail(value: string) {
  return value.trim().toLowerCase();
}

/** Combine Clerk's one-time invitations with its durable user accounts. */
export function summarizeClerkMembers(
  emails: string[],
  invitations: ClerkInvitationSummary[],
  users: ClerkUserSummary[]
): Map<string, ClerkMember> {
  const wanted = [...new Set(emails.map(normalizeMemberEmail).filter(Boolean))];
  const result = new Map<string, ClerkMember>(
    wanted.map((email) => [email, MISSING_CLERK_MEMBER])
  );

  // The caller supplies invitations newest first. Keep the newest exact match;
  // a registered user below always takes precedence over an old invite.
  for (const invitation of invitations) {
    const email = normalizeMemberEmail(invitation.emailAddress);
    if (!result.has(email) || result.get(email)?.state !== 'missing') continue;
    if (invitation.status === 'pending') {
      result.set(email, { state: 'invited', userId: null, displayName: null });
    } else if (invitation.status === 'expired') {
      result.set(email, { state: 'expired', userId: null, displayName: null });
    }
  }

  for (const user of users) {
    const matchingEmail = user.emailAddresses
      .map((address) => normalizeMemberEmail(address.emailAddress))
      .find((email) => result.has(email));
    if (!matchingEmail) continue;
    result.set(matchingEmail, {
      state: 'registered',
      userId: user.id,
      displayName: user.fullName || user.username || null,
    });
  }

  return result;
}
