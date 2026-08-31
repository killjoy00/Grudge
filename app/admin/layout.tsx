/**
 * Admin section guard.
 *
 * notFound() rather than a redirect or a 403 page: a signed-in member who is
 * not an admin should not learn that /admin is a real route. They get the same
 * 404 as a typo.
 *
 * This guard is the courtesy layer. The guarantee is that every table these
 * pages read carries `using (public.is_admin())`, enforced by Postgres against
 * a connection with no BYPASSRLS -- so even if this file were deleted, the
 * pages would render empty rather than leak. tests/admin/verify-gating.mjs
 * proves that by hitting the API routes with a real non-admin session.
 */
import { notFound } from 'next/navigation';
import { adminProfile } from '../../lib/admin.ts';

// Reads the session. Must never be prerendered or cached.
export const dynamic = 'force-dynamic';

const TABS = [
  ['/admin', 'Overview'],
  ['/admin/members', 'Members'],
  ['/admin/recaps', 'Recaps'],
  ['/admin/pool', 'Free agents'],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await adminProfile();
  if (!profile) notFound();

  return (
    <>
      <div className="adminbar">
        <span className="badge">Admin</span>
        {TABS.map(([href, label]) => (
          <a key={href} href={href}>{label}</a>
        ))}
      </div>
      {children}
    </>
  );
}
