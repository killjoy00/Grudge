/**
 * Clerk middleware verifies the session for every application request.
 *
 * Authorization lives next to each protected resource instead of in a path
 * matcher: pages call auth.protect() or adminProfile(), server actions call
 * auth()/adminProfile(), and API handlers call requireAdminApi(). This follows
 * Clerk's resource-first guidance and avoids the deprecated
 * createRouteMatcher helper. The database's RLS policies remain the final
 * authorization boundary.
 *
 * Vercel Preview is a special case: if its Preview environment has not been
 * assigned the Clerk variables yet, let requests reach an auth-free review
 * surface instead of crashing middleware. Production never fails open.
 */
import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { previewWithoutClerk } from './lib/clerk-config.ts';

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (previewWithoutClerk()) {
    if (request.nextUrl.pathname === '/') {
      return NextResponse.redirect(new URL('/preview', request.url));
    }
    return NextResponse.next();
  }
  return clerkMiddleware()(request, event);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
