import { auth } from '@clerk/nextjs/server';
import { currentProfile } from '../../lib/db.ts';
import { ProfileForm } from '../../components/ProfileForm.tsx';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  await auth.protect();
  const profile = await currentProfile();

  if (!profile) {
    return (
      <>
        <div className="page-hero compact-hero">
          <div className="eyebrow">Account</div>
          <h1>Profile setup incomplete</h1>
          <p>Your Clerk sign-in exists, but the league membership record does not.</p>
        </div>
        <div className="card">
          <p>
            You are signed in, but your league profile has not been created yet.
            Ask the commissioner to confirm that your email is active in the league
            roster and run Repair sync if the Clerk webhook did not finish.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Account preferences</div>
        <h1>{profile.display_name || 'Your profile'}</h1>
        <p>
          {profile.team_name ?? `Team ${profile.espn_team_id ?? 'not assigned'}`}
          {profile.is_admin ? ' · Commissioner' : ''}
        </p>
      </div>
      <div className="card">
        <ProfileForm
          initialName={profile.display_name ?? ''}
          initialRecapEnabled={profile.recap_email_enabled}
        />
        <p className="note profile-email">Recaps are sent to {profile.email}.</p>
      </div>
    </>
  );
}
