/**
 * Clerk middleware verifies the session for every application request.
 *
 * Authorization lives next to each protected resource instead of in a path
 * matcher: pages call auth.protect() or adminProfile(), server actions call
 * auth()/adminProfile(), and API handlers call requireAdminApi(). This follows
 * Clerk's resource-first guidance and avoids the deprecated
 * createRouteMatcher helper. The database's RLS policies remain the final
 * authorization boundary.
 */
import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
