export function clerkConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
  );
}

/**
 * Preview deployments are intentionally reviewable even if Vercel's Preview
 * environment has not been given the Clerk secrets yet. Production never
 * takes this path: a missing auth configuration there must still fail loudly.
 */
export function previewWithoutClerk(): boolean {
  return process.env.VERCEL_ENV === 'preview' && !clerkConfigured();
}
