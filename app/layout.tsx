import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Nav } from '../components/Nav.tsx';
import { AuthButton } from '../components/AuthButton.tsx';
import { LeagueMark } from '../components/LeagueMark.tsx';
import { previewWithoutClerk } from '../lib/clerk-config.ts';

export const metadata: Metadata = {
  title: 'UNC Grudge Match',
  description:
    'Standings, power rankings, playoff odds and predictions for the UNC Grudge Match fantasy league.',
};

// Mobile-first: lock the viewport to device width so wide tables scroll inside
// their own container rather than zooming the whole page out.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#071d35',
};

// Deliberately NOT async, and deliberately not calling auth(). Any dynamic API
// used here applies to every route beneath it, which would force the whole site
// to server-render per request and quietly disable the `revalidate` exports on
// the league pages. The session is resolved client-side in <AuthButton />.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const previewNoAuth = previewWithoutClerk();
  const shell = (
    <html lang="en">
      <body>
        <header className="site">
          <div className="headrow">
            <a href="/" className="brand">
              <LeagueMark />
              <span className="brand-copy">
                <strong>Grudge Match</strong>
                <small>UNC fantasy football · est. 2005</small>
              </span>
            </a>
            <div className="spacer" />
            {previewNoAuth ? (
              <div className="authcontrols">
                <a href="/me">Preview My Grudge</a>
              </div>
            ) : (
              <AuthButton />
            )}
          </div>
          {/* The tab strip scrolls horizontally on a phone -- seven tabs
              cannot fit in 375px. This wrapper exists solely to hang a
              right-edge fade off, so it is visible that there is more. */}
          <div className="tabs-wrap">
            <Nav />
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site-footer">
          <span>UNC Grudge Match</span>
          <span>Keep the receipts.</span>
        </footer>
      </body>
    </html>
  );

  return previewNoAuth ? shell : <ClerkProvider>{shell}</ClerkProvider>;
}
