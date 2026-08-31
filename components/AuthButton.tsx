'use client';

/**
 * The sign-in / account control in the header.
 *
 * This is a client component for a specific reason. Reading the session on the
 * server -- `await auth()` in the layout -- opts EVERY route into per-request
 * rendering, because the layout wraps them all. That silently killed the
 * `revalidate` exports on standings, rankings, odds and history: they were
 * being server-rendered on every hit rather than cached.
 *
 * Resolving the session in the browser instead keeps the layout static, so
 * pages that depend only on league data can be prerendered and served from the
 * edge. The tradeoff is a brief moment where neither button is shown; that is
 * held open by a fixed-size placeholder so the header does not jump.
 *
 * Nothing about access control lives here. Clerk Core 3 removed <SignedIn> and
 * <SignedOut> (they still export, but throw when rendered), and in any case the
 * real guarantee is in lib/db.ts, which sets no database identity without a
 * verified session. This component only decides which button to draw.
 */
import { useUser, SignInButton, UserButton } from '@clerk/nextjs';

export function AuthButton() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) return <span className="authslot" aria-hidden />;

  return isSignedIn ? (
    <div className="authcontrols">
      <a href="/me">Profile</a>
      <UserButton />
    </div>
  ) : (
    <SignInButton mode="modal">
      <button>Sign in</button>
    </SignInButton>
  );
}
