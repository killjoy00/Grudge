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
  // '/admin(.*)' does NOT cover '/api/admin/...' -- the matcher is anchored at
  // the start of the path. Listing it separately keeps an unauthenticated call
  // to the JSON routes from reaching the handler at all. The handler's own
  // requireAdminApi() and the RLS policies still stand behind this; it is the
  // outermost of three layers, not the one that matters most.
  '/api/admin(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
};
