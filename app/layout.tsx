import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ClerkProvider, SignInButton, UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { Nav } from '../components/Nav.tsx';

export const metadata: Metadata = {
  title: 'UNC Grudge Match',
  description:
    'Standings, power rankings, playoff odds and predictions for the UNC Grudge Match fantasy league.',
};

// Mobile-first: lock the viewport to device width so wide tables scroll inside
// their own container rather than zooming the whole page out.
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Clerk Core 3 removed the <SignedIn>/<SignedOut> components -- they still
  // export but throw when rendered. The server session is the supported route,
  // and it suits a server component better anyway: no client boundary just to
  // decide which button to show.
  const { userId } = await auth();

  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header className="site">
            <div className="headrow">
              <a href="/" className="brand">
                UNC Grudge Match
                <span>Est. 2018 on record</span>
              </a>
              <div className="spacer" />
              {userId ? (
                <UserButton />
              ) : (
                <SignInButton mode="modal">
                  <button>Sign in</button>
                </SignInButton>
              )}
            </div>
            <Nav />
          </header>
          <main className="wrap">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
