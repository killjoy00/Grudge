import { notFound } from 'next/navigation';

import { MembershipManager } from '../../../components/MembershipManager.tsx';
import { adminProfile } from '../../../lib/admin.ts';
import { getAllowlist, getProvisionedMembers } from '../../../lib/admin-queries.ts';
import { getClerkAllowlist } from '../../../lib/clerk-admin.ts';
import { getCurrentSeason, getTeams } from '../../../lib/queries.ts';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  if (!(await adminProfile())) notFound();

  const season = await getCurrentSeason();
  const [allowlist, members, teams, clerkResult] = await Promise.all([
    getAllowlist(),
    getProvisionedMembers(),
    getTeams(season),
    getClerkAllowlist().then(
      (entries) => ({ entries, error: false }),
      () => ({ entries: [], error: true })
    ),
  ]);

  const profiles = new Map(members.map((member) => [member.email.toLowerCase(), member]));
  const clerkEmails = new Set(
    clerkResult.entries.map((entry) => entry.identifier.toLowerCase())
  );
  const rows = allowlist.map((member) => {
    const profile = profiles.get(member.email.toLowerCase());
    return {
      email: member.email,
      season: member.season ?? season,
      espnTeamId: member.espn_team_id,
      isAdmin: member.is_admin,
      isActive: member.is_active,
      clerkListed: clerkEmails.has(member.email.toLowerCase()),
      profileId: profile?.id ?? null,
      displayName: profile?.display_name ?? null,
      recapEnabled: profile?.recap_email_enabled ?? null,
    };
  });

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Commissioner tools</div>
        <h1>League membership</h1>
        <p>One roster for sign-in access, ESPN assignments, and recap eligibility.</p>
      </div>
      <MembershipManager
        rows={rows}
        teams={teams.map((team) => ({ id: team.espn_team_id, name: team.name }))}
        season={season}
        clerkError={clerkResult.error}
      />
    </>
  );
}
