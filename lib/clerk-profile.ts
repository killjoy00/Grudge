/** Minimal, testable extraction from Clerk's user.created/user.updated payload. */

export interface ClerkUserPayload {
  id: string;
  primary_email_address_id: string | null;
  email_addresses: Array<{ id: string; email_address: string }>;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
}

export interface ProvisionProfileInput {
  id: string;
  email: string;
  displayName: string | null;
}

export function profileInputFromClerk(user: ClerkUserPayload): ProvisionProfileInput | null {
  const primary = user.email_addresses.find(
    (address) => address.id === user.primary_email_address_id
  ) ?? user.email_addresses[0];
  const email = primary?.email_address.trim().toLowerCase();
  if (!user.id || !email) return null;

  const fullName = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');

  return {
    id: user.id,
    email,
    displayName: fullName || user.username?.trim() || null,
  };
}
