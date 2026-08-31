import { currentProfile } from '../../lib/db.ts';
import { ProfileForm } from '../../components/ProfileForm.tsx';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const profile = await currentProfile();

  if (!profile) {
    return (
      <>
        <h1>Profile setup incomplete</h1>
        <div className="card">
          <p>
            You are signed in, but your league profile has not been created yet.
            Ask the commissioner to confirm that your email is on the league allowlist
            and that the Clerk provisioning webhook completed successfully.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Your profile</h1>
      <p className="sub">
        Team {profile.espn_team_id ?? 'not assigned'}{profile.is_admin ? ' · commissioner' : ''}
      </p>
      <div className="card">
        <ProfileForm initialName={profile.display_name ?? ''} />
      </div>
    </>
  );
}
