import { auth } from '@clerk/nextjs/server';
import { currentProfile } from '../../lib/db.ts';
import { previewWithoutClerk } from '../../lib/clerk-config.ts';
import { getMyGrudgeDashboard, type MyGrudgeDashboard } from '../../lib/my-grudge.ts';
import { getCurrentSeason, getTeams, type TeamRow } from '../../lib/queries.ts';
import { ProfileForm } from '../../components/ProfileForm.tsx';

export const dynamic = 'force-dynamic';

function record(wins: number, losses: number, ties: number) {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function movement(rank: number, previous: number | null) {
  if (previous === null || previous === rank) return null;
  const change = previous - rank;
  return `${change > 0 ? '↑' : '↓'} ${Math.abs(change)}`;
}

type PageProfile = {
  display_name: string | null;
  team_name: string | null;
  espn_team_id: number | null;
  is_admin: boolean;
  recap_email_enabled: boolean;
  email: string;
};

function DashboardView({
  profile,
  dashboard,
  previewMode,
  previewTeams,
}: {
  profile: PageProfile;
  dashboard: MyGrudgeDashboard | null;
  previewMode: boolean;
  previewTeams: TeamRow[];
}) {
  const powerMove = dashboard?.power
    ? movement(dashboard.power.rank, dashboard.power.previous_rank)
    : null;

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">My Grudge</div>
        <h1>{profile.team_name ?? profile.display_name ?? 'Your team'}</h1>
        <p>
          {previewMode ? 'Preview mode' : profile.display_name || 'League member'}
          {!previewMode && profile.is_admin ? ' · Commissioner' : ''}
          {dashboard ? ` · ${dashboard.season} season` : ''}
        </p>
      </div>

      {previewMode && (
        <div className="callout">
          <strong>Preview without sign-in.</strong> Vercel Preview does not currently have the Clerk
          variables, so this page is using public league data only. Choose any team below to inspect
          the dashboard. Production authentication remains unchanged.
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {previewTeams.map((team) => (
              <a
                key={team.espn_team_id}
                href={`/me?team=${team.espn_team_id}`}
                className={team.espn_team_id === profile.espn_team_id ? 'btn' : 'btn btn-quiet'}
              >
                {team.name}
              </a>
            ))}
          </div>
        </div>
      )}

      {dashboard ? (
        <>
          <div className="stat-strip three">
            <div>
              <span>Record</span>
              <strong>
                {dashboard.record
                  ? record(dashboard.record.wins, dashboard.record.losses, dashboard.record.ties)
                  : '0-0'}
              </strong>
              <small className="block note">
                {dashboard.standing_rank ? `#${dashboard.standing_rank} in standings` : 'Season has not settled a week yet'}
              </small>
            </div>
            <div>
              <span>Power rank</span>
              <strong>{dashboard.power ? `#${dashboard.power.rank}` : '—'}</strong>
              <small className="block note">
                {dashboard.power
                  ? `${powerMove ? `${powerMove} · ` : ''}through week ${dashboard.power.week}`
                  : 'Starts after week 1'}
              </small>
            </div>
            <div>
              <span>Playoff odds</span>
              <strong>{dashboard.odds ? `${dashboard.odds.playoff_pct}%` : '—'}</strong>
              <small className="block note">
                {dashboard.odds ? `${dashboard.odds.bye_pct}% bye chance` : 'No model yet'}
              </small>
            </div>
          </div>

          <h2>This week</h2>
          <div className="card">
            {!dashboard.active ? (
              <p className="empty" style={{ margin: 0 }}>
                No regular-season matchup is waiting. The current season is settled.
              </p>
            ) : dashboard.active.matchup_id === null ? (
              <p className="empty" style={{ margin: 0 }}>
                Week {dashboard.active.week} is current, but no matchup is attached to this team yet.
              </p>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <div>
                    <div className="eyebrow">Week {dashboard.active.week}</div>
                    <h3 style={{ margin: '3px 0 3px' }}>
                      vs. {dashboard.active.opponent_name ?? 'Opponent'}
                    </h3>
                    {dashboard.active.opponent_owners && (
                      <p className="note" style={{ margin: 0 }}>
                        Managed by {dashboard.active.opponent_owners}
                      </p>
                    )}
                  </div>
                  {dashboard.active.my_projection !== null && dashboard.active.opponent_projection !== null && (
                    <div style={{ textAlign: 'right' }}>
                      <div className="note">Tuesday projection</div>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {dashboard.active.my_projection} – {dashboard.active.opponent_projection}
                      </strong>
                    </div>
                  )}
                </div>

                {dashboard.active.grudge_games > 0 && dashboard.active.manager_key && dashboard.active.opponent_manager_key && (
                  <p className="note" style={{ margin: '14px 0 0' }}>
                    Manager grudge: <strong>
                      {record(
                        dashboard.active.grudge_wins,
                        dashboard.active.grudge_losses,
                        dashboard.active.grudge_ties
                      )}
                    </strong> for {dashboard.active.manager_name ?? 'your manager'} against {dashboard.active.opponent_manager_name ?? 'the opposing manager'} across {dashboard.active.grudge_games} meeting{dashboard.active.grudge_games === 1 ? '' : 's'}.
                    {' '}<a href={`/grudge/${encodeURIComponent(dashboard.active.manager_key)}/${encodeURIComponent(dashboard.active.opponent_manager_key)}`}>Full grudge →</a>
                  </p>
                )}

                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                  {dashboard.active.picks_made === null ? (
                    <p className="note" style={{ margin: 0 }}>
                      Prediction completion is hidden in this unauthenticated preview. Matchup,
                      projections and manager-grudge context are still the real current-season data.
                    </p>
                  ) : (
                    <p className="note" style={{ margin: 0 }}>
                      <strong>{dashboard.active.picks_made}/{dashboard.active.picks_total}</strong> picks made for week {dashboard.active.week}.
                      {' '}{dashboard.active.locked ? 'The board is locked.' : 'You can still change them.'}
                    </p>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    <a
                      href={`/matchup/${dashboard.season}/${dashboard.active.week}/${dashboard.active.matchup_id}`}
                      className="btn"
                    >
                      Matchup preview
                    </a>
                    {!previewMode && (
                      <a href="/predictions" className="btn btn-quiet">
                        {dashboard.active.locked ? 'Review picks' : 'Finish picks'}
                      </a>
                    )}
                    {profile.espn_team_id !== null && (
                      <a href={`/team/${profile.espn_team_id}`} className="btn btn-quiet">Team page</a>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <h2>Recent roster moves</h2>
          <div className="card">
            {dashboard.recent_moves.length === 0 ? (
              <p className="empty" style={{ margin: 0 }}>No waiver or free-agent adds yet this season.</p>
            ) : dashboard.recent_moves.map((move, index) => {
              const spend = move.bid_amount === null ? null : `$${Number(move.bid_amount).toFixed(2)} FAAB`;
              return (
                <div
                  key={`${move.week}:${move.player_name}:${index}`}
                  style={{
                    padding: '10px 0',
                    borderBottom: index === dashboard.recent_moves.length - 1 ? undefined : '1px solid var(--line)',
                  }}
                >
                  <strong>{move.player_name}</strong>
                  <p className="note" style={{ margin: '3px 0 0' }}>
                    Week {move.week} · {move.acquisition_type === 'WAIVER' ? 'Waivers' : 'Free agency'}
                    {spend ? ` · ${spend}` : ''}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="card">
          <p className="note" style={{ margin: 0 }}>
            This league profile is active, but it is not attached to an ESPN team yet.
          </p>
        </div>
      )}

      <h2>Account settings</h2>
      <div className="card">
        {previewMode ? (
          <p className="note" style={{ margin: 0 }}>
            Account controls are disabled in this unauthenticated Preview fallback. Once Clerk is
            assigned to Vercel Preview, this exact page uses the signed-in manager automatically.
          </p>
        ) : (
          <>
            <ProfileForm
              initialName={profile.display_name ?? ''}
              initialRecapEnabled={profile.recap_email_enabled}
            />
            <p className="note profile-email">Recaps are sent to {profile.email}.</p>
          </>
        )}
      </div>
    </>
  );
}

export default async function ProfilePage({
  searchParams,
}: { searchParams: Promise<{ team?: string }> }) {
  const sp = await searchParams;
  const previewMode = previewWithoutClerk();

  if (previewMode) {
    const season = await getCurrentSeason();
    const teams = await getTeams(season);
    const requestedTeam = Number(sp.team);
    const selected = teams.find((team) => team.espn_team_id === requestedTeam) ?? teams[0] ?? null;

    if (!selected) {
      return (
        <>
          <div className="page-hero compact-hero">
            <div className="eyebrow">My Grudge</div>
            <h1>No teams to preview</h1>
            <p>The current season has no team rows loaded yet.</p>
          </div>
        </>
      );
    }

    const dashboard = await getMyGrudgeDashboard(selected.espn_team_id, { includePicks: false });
    return (
      <DashboardView
        previewMode
        previewTeams={teams}
        dashboard={dashboard}
        profile={{
          display_name: null,
          team_name: selected.name,
          espn_team_id: selected.espn_team_id,
          is_admin: false,
          recap_email_enabled: false,
          email: '',
        }}
      />
    );
  }

  await auth.protect();
  const profile = await currentProfile();

  if (!profile) {
    return (
      <>
        <div className="page-hero compact-hero">
          <div className="eyebrow">My Grudge</div>
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

  const dashboard = profile.espn_team_id === null
    ? null
    : await getMyGrudgeDashboard(profile.espn_team_id);

  return (
    <DashboardView
      previewMode={false}
      previewTeams={[]}
      profile={profile}
      dashboard={dashboard}
    />
  );
}
