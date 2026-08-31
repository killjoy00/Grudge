/**
 * Admin overview: who is on the league roster, who has actually signed in, and
 * whether the weekly ownership capture is running.
 *
 * The "pending" list answers the only support question this league will
 * generate -- "I can't get in" -- without anyone having to open the database.
 */
import { getAllowlist, getProvisionedMembers, getSnapshotCoverage } from '../../lib/admin-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';
import { adminProfile } from '../../lib/admin.ts';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  if (!(await adminProfile())) notFound();
  const season = await getCurrentSeason();
  const [allowlist, members, coverage] = await Promise.all([
    getAllowlist(),
    getProvisionedMembers(),
    getSnapshotCoverage(season),
  ]);

  const activeAllowlist = allowlist.filter((member) => member.is_active);
  const claimed = new Set(members.map((m) => m.email.toLowerCase()));
  const pending = activeAllowlist.filter((a) => !claimed.has(a.email.toLowerCase()));

  return (
    <>
      <h1>League admin</h1>
      <p className="sub">
        {activeAllowlist.length} active · {members.filter((m) => m.is_active).length} signed in
      </p>

      <div className="card admin-shortcut">
        <div>
          <div className="section-kicker">Membership</div>
          <strong>Add members, assign teams, and send Clerk invitations</strong>
        </div>
        <a href="/admin/members" className="btn">Manage members</a>
      </div>

      {pending.length > 0 && (
        <div className="card">
          <h2>Not signed in yet</h2>
          <p className="note">
            Active in the league database but not provisioned yet. The Members
            screen shows whether their Clerk invitation is pending or needs repair.
          </p>
          <ul className="plain">
            {pending.map((p) => (
              <li key={p.email}>
                {p.email}
                {p.espn_team_id ? <span className="tsub"> · team {p.espn_team_id}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>Members</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Email</th><th>Team</th><th>Admin</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.display_name ?? m.email}</td>
                  <td>{m.team_name ?? (m.espn_team_id ? `team ${m.espn_team_id}` : '—')}</td>
                  <td>{m.is_admin ? 'yes' : ''}{!m.is_active ? ' · inactive' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          The active league roster in Postgres is authoritative. Clerk's free
          Invite-only mode controls registration; the Members screen sends and repairs invitations.
        </p>
      </div>

      <div className="card">
        <h2>Ownership capture</h2>
        {coverage.length === 0 ? (
          <p className="empty">
            No snapshots for {season} yet. The weekly job writes one each
            Tuesday; until two exist there is no trend to compute.
          </p>
        ) : (
          <div className="scroll">
            <table>
              <thead><tr><th>Week</th><th>Players</th><th>Captured</th></tr></thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.week}>
                    <td>{c.week}</td>
                    <td>{c.players}</td>
                    <td className="tsub">{new Date(c.captured_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
