import { auth } from '@clerk/nextjs/server';
import { currentProfile } from '../../lib/db.ts';
import { getMyGrudgeDashboard } from '../../lib/my-grudge.ts';
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

export default async function ProfilePage() {
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
  const powerMove = dashboard?.power
    ? movement(dashboard.power.rank, dashboard.power.previous_rank)
    : null;

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">My Grudge</div>
        <h1>{profile.team_name ?? profile.display_name ?? 'Your team'}</h1>
        <p>
          {profile.display_name || 'League member'}
          {profile.is_admin ? ' · Commissioner' : ''}
          {dashboard ? ` · ${dashboard.season} season` : ''}
        </p>
      </div>

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
                Week {dashboard.active.week} is current, but no matchup is attached to your team yet.
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

                {dashboard.active.rivalry_games > 0 && (
                  <p className="note" style={{ margin: '14px 0 0' }}>
                    All-time series: <strong>
                      {record(
                        dashboard.active.rivalry_wins,
                        dashboard.active.rivalry_losses,
                        dashboard.active.rivalry_ties
                      )}
                    </strong> across {dashboard.active.rivalry_games} meeting{dashboard.active.rivalry_games === 1 ? '' : 's'}.
                    {dashboard.active.opponent_id !== null && (
                      <> <a href={`/rivalry/${profile.espn_team_id}/${dashboard.active.opponent_id}`}>Full rivalry →</a></>
                    )}
                  </p>
                )}

                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                  <p className="note" style={{ margin: 0 }}>
                    <strong>{dashboard.active.picks_made}/{dashboard.active.picks_total}</strong> picks made for week {dashboard.active.week}.
                    {' '}{dashboard.active.locked ? 'The board is locked.' : 'You can still change them.'}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    <a
                      href={`/matchup/${dashboard.season}/${dashboard.active.week}/${dashboard.active.matchup_id}`}
                      className="btn"
                    >
                      Matchup preview
                    </a>
                    <a href="/predictions" className="btn btn-quiet">
                      {dashboard.active.locked ? 'Review picks' : 'Finish picks'}
                    </a>
                    <a href={`/team/${profile.espn_team_id}`} className="btn btn-quiet">Team page</a>
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
            Your league profile is active, but it is not attached to an ESPN team yet.
            Once the team assignment is repaired, this page will show your season dashboard.
          </p>
        </div>
      )}

      <h2>Account settings</h2>
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
