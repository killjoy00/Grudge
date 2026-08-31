import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Nav } from '../components/Nav.tsx';
import { AuthButton } from '../components/AuthButton.tsx';

export const metadata: Metadata = {
  title: 'UNC Grudge Match',
  description:
    'Standings, power rankings, playoff odds and predictions for the UNC Grudge Match fantasy league.',
};

// Mobile-first: lock the viewport to device width so wide tables scroll inside
// their own container rather than zooming the whole page out.
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Deliberately NOT async, and deliberately not calling auth(). Any dynamic API
// used here applies to every route beneath it, which would force the whole site
// to server-render per request and quietly disable the `revalidate` exports on
// the league pages. The session is resolved client-side in <AuthButton />.
export default function RootLayout({ children }: { children: React.ReactNode }) {
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
              <AuthButton />
            </div>
            <Nav />
          </header>
          <main className="wrap">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
