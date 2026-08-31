/**
 * Clerk middleware.
 *
 * Public pages (standings, rankings, history) render for anyone; the
 * interactive pages require a session. Note the protection here is a
 * convenience redirect -- the actual guarantee is that lib/db.ts sets no
 * identity without a verified session, so an unauthenticated request reaching
 * a protected route anyway would simply see nothing user-owned.
 */
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtected = createRouteMatcher([
  '/predictions(.*)',
  '/me(.*)',
  '/admin(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
};
