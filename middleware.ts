/**
 * Clerk needs to see only requests that read an authenticated session.
 * Public reports, cached scoreboards, player pages and historical recaps are
 * excluded before this middleware executes (including CDN cache hits).
 *
 * Keep auth()/auth.protect() and database RLS at each private resource.
 * Next.js Server Actions POST to the owning page path, so /me, /predictions,
 * /trades and /admin must remain matched. The Clerk frontend needs /__clerk.
 */
import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { previewWithoutClerk } from './lib/clerk-config.ts';

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (previewWithoutClerk()) return NextResponse.next();
  return clerkMiddleware()(request, event);
}

export const config = {
  matcher: [
    '/predictions/:path*',
    '/me/:path*',
    '/admin/:path*',
    '/trades/:path*',
    '/api/home-member',
    '/api/admin/:path*',
    '/__clerk/(.*)',
  ],
};
