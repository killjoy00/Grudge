import { notFound } from 'next/navigation';
import { LeagueWire } from '../../components/LeagueWire.tsx';
import { previewWithoutClerk } from '../../lib/clerk-config.ts';
import { getLeagueWire, type LeagueWireEvent } from '../../lib/league-wire.ts';
import { getMyGrudgeDashboard, type MyGrudgeDashboard } from '../../lib/my-grudge.ts';
import { getCurrentSeason, getTeams } from '../../lib/queries.ts';

export const dynamic = 'force-dynamic';

const SAMPLE_WIRE: LeagueWireEvent[] = [
  {
    id: 'preview-trade', kind: 'trade', season: 2026, week: 1,
    title: 'Two teams completed a trade',
    detail: 'League Wire puts the transaction, players and downstream trade page one tap from the Scoreboard.',
    href: '/trades', happened_at: null,
  },
  {
    id: 'preview-pickup', kind: 'pickup', season: 2026, week: 1,
    title: 'A waiver claim landed',
    detail: 'Player, acquiring team and FAAB cost appear together when the transaction feed has them.',
    href: null, happened_at: null,
  },
  {
    id: 'preview-ranking', kind: 'ranking', season: 2026, week: 1,
    title: 'A team jumped three spots in the power rankings',
    detail: 'Only meaningful movement hits the Wire, so routine one-place churn does not flood the feed.',
    href: '/rankings', happened_at: null,
  },
  {
    id: 'preview-award', kind: 'award', season: 2026, week: 1,
    title: 'Weekly high scorer',
    detail: 'Awards, prediction results, records and recap publication can all join the same chronological stream.',
    href: null, happened_at: null,
  },
];

function record(dashboard: MyGrudgeDashboard | null) {
  if (!dashboard?.record) return '0-0';
  const { wins, losses, ties } = dashboard.record;
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export default async function PreviewPage() {
  if (!previewWithoutClerk()) notFound();

  let dashboard: MyGrudgeDashboard | null = null;
  let teamName = 'Your team';
  let teamId: number | null = null;
  let wire = SAMPLE_WIRE;
  let liveData = false;

  try {
    const season = await getCurrentSeason();
    const [teams, events] = await Promise.all([
      getTeams(season),
      getLeagueWire(season, 16),
    ]);
    const selected = teams[0] ?? null;
    if (selected) {
      teamName = selected.name;
      teamId = selected.espn_team_id;
      dashboard = await getMyGrudgeDashboard(selected.espn_team_id, { includePicks: false });
    }
    wire = events.length > 0 ? events : SAMPLE_WIRE;
    liveData = true;
  } catch {
    // Preview must remain reviewable even if Vercel Preview is also missing the
    // database variable. Production does not use this route.
  }

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">PR #57 · non-production</div>
        <h1>Feature review</h1>
        <p>
          This review surface exists only because Vercel Preview is currently missing Clerk.
          Production auth is unchanged and still fails closed.
        </p>
      </div>

      <nav aria-label="Preview pages" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 20px' }}>
        <a className="btn btn-quiet" href="/history">History →</a>
        <a className="btn btn-quiet" href="/history/rivalries">Grudges →</a>
        <a className="btn btn-quiet" href="/history/drafts">Draft history →</a>
        <a className="btn btn-quiet" href="/history/records">Record book →</a>
      </nav>

      <div className="callout">
        <strong>{liveData ? 'Using live league data.' : 'Layout sample mode.'}</strong>{' '}
        {liveData
          ? 'Private pick status is intentionally hidden because this preview has no signed-in identity.'
          : 'The Preview environment is also missing the database connection, so representative values are being used only to review layout and hierarchy.'}
      </div>

      <section aria-labelledby="my-grudge-preview-heading">
        <div className="page-hero compact-hero" style={{ marginBottom: 12 }}>
          <div className="eyebrow">Personal command center</div>
          <h2 id="my-grudge-preview-heading" style={{ marginBottom: 4 }}>My Grudge</h2>
          <p>What matters to one manager, pulled out of the league-wide pages and put in one place.</p>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div>
              <div className="eyebrow">Current team</div>
              <h3 style={{ margin: '3px 0 0' }}>{teamName}</h3>
            </div>
            {teamId !== null && <a className="btn btn-quiet" href={`/me?team=${teamId}`}>Open full dashboard</a>}
          </div>
        </div>

        <div className="stat-strip three">
          <div>
            <span>Record</span>
            <strong>{dashboard ? record(dashboard) : '3-1'}</strong>
            <small className="block note">
              {dashboard?.standing_rank ? `#${dashboard.standing_rank} in standings` : liveData ? 'Season has not settled a week yet' : '#2 in standings'}
            </small>
          </div>
          <div>
            <span>Power rank</span>
            <strong>{dashboard?.power ? `#${dashboard.power.rank}` : liveData ? '—' : '#3'}</strong>
            <small className="block note">
              {dashboard?.power ? `through week ${dashboard.power.week}` : liveData ? 'Starts after week 1' : '↑ 2 this week'}
            </small>
          </div>
          <div>
            <span>Playoff odds</span>
            <strong>{dashboard?.odds ? `${dashboard.odds.playoff_pct}%` : liveData ? '—' : '68.4%'}</strong>
            <small className="block note">
              {dashboard?.odds ? `${dashboard.odds.bye_pct}% bye chance` : liveData ? 'No model yet' : '14.2% bye chance'}
            </small>
          </div>
        </div>

        <div className="card">
          <div className="eyebrow">This week</div>
          <h3 style={{ margin: '4px 0 6px' }}>
            {dashboard?.active?.opponent_name ? `vs. ${dashboard.active.opponent_name}` : 'vs. current opponent'}
          </h3>
          <p className="note" style={{ margin: 0 }}>
            {dashboard?.active?.my_projection && dashboard?.active?.opponent_projection
              ? `Tuesday projection: ${dashboard.active.my_projection} – ${dashboard.active.opponent_projection}. `
              : 'Tuesday projections, matchup context and rivalry history live here. '}
            Prediction completion is hidden only in this auth-free Preview fallback.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {dashboard?.active?.matchup_id && (
              <a className="btn" href={`/matchup/${dashboard.season}/${dashboard.active.week}/${dashboard.active.matchup_id}`}>
                Matchup preview
              </a>
            )}
            {teamId !== null && <a className="btn btn-quiet" href={`/team/${teamId}`}>Team page</a>}
          </div>
        </div>

        <div className="card">
          <strong>Recent roster moves</strong>
          {dashboard?.recent_moves.length ? dashboard.recent_moves.slice(0, 3).map((move, index) => (
            <div key={`${move.week}:${move.player_name}:${index}`} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <strong>{move.player_name}</strong>
              <p className="note" style={{ margin: '3px 0 0' }}>
                Week {move.week} · {move.acquisition_type === 'WAIVER' ? 'Waivers' : 'Free agency'}
                {move.bid_amount !== null ? ` · $${Number(move.bid_amount).toFixed(2)} FAAB` : ''}
              </p>
            </div>
          )) : (
            <p className="note" style={{ marginBottom: 0 }}>
              Recent waiver/free-agent adds appear here with FAAB when available.
            </p>
          )}
        </div>
      </section>

      <LeagueWire events={wire} />
    </>
  );
}
