/**
 * Admin overview: who is on the allowlist, who has actually signed in, and
 * whether the weekly ownership capture is running.
 *
 * The "pending" list answers the only support question this league will
 * generate -- "I can't get in" -- without anyone having to open the database.
 */
import { getAllowlist, getProvisionedMembers, getSnapshotCoverage } from '../../lib/admin-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const season = await getCurrentSeason();
  const [allowlist, members, coverage] = await Promise.all([
    getAllowlist(),
    getProvisionedMembers(),
    getSnapshotCoverage(season),
  ]);

  const claimed = new Set(members.map((m) => m.email.toLowerCase()));
  const pending = allowlist.filter((a) => !claimed.has(a.email.toLowerCase()));

  return (
    <>
      <h1>League admin</h1>
      <p className="sub">{allowlist.length} on the allowlist · {members.length} signed in</p>

      {pending.length > 0 && (
        <div className="card">
          <h2>Not signed in yet</h2>
          <p className="note">
            On the allowlist but no profile, so they have never completed a magic-link
            sign-in. Nothing is wrong with their account — they just have not tried.
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
                  <td>{m.is_admin ? 'yes' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Admin status comes from the allowlist and is written once, by
          provision_profile(). It cannot be changed from the app — a database trigger
          refuses any update touching it while a session identity is set.
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
