/**
 * Free-agent pool analysis.
 *
 * The useful column here is the ownership GAP, not projected points. Everyone
 * in the league already sees ESPN's projections in ESPN's own UI, so ranking by
 * them surfaces nothing new. "73% of ESPN owns this player and he is still on
 * our waiver wire" is information the UI does not show anywhere.
 *
 * Two trend numbers are shown side by side on purpose -- ESPN's own weekly
 * delta, and the one computed from our previous snapshot. They measure the same
 * thing from independent data, so a disagreement means our capture cadence
 * slipped. One number alone would have looked perfectly plausible while being
 * wrong.
 */
import { getPool, getPoolOpportunities, getSnapshotCoverage } from '../../../lib/admin-queries.ts';
import { getCurrentSeason } from '../../../lib/queries.ts';
import { adminProfile } from '../../../lib/admin.ts';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

function pct(v: string | null) {
  return v === null ? '—' : `${Number(v).toFixed(1)}%`;
}

function delta(v: string | null) {
  if (v === null) return <span className="tsub">—</span>;
  const n = Number(v);
  if (Math.abs(n) < 0.05) return <span className="tsub">flat</span>;
  return <span className={n > 0 ? 'up' : 'down'}>{n > 0 ? '+' : ''}{n.toFixed(1)}</span>;
}

export default async function Pool({
  searchParams,
}: { searchParams: Promise<{ week?: string }> }) {
  if (!(await adminProfile())) notFound();
  const season = await getCurrentSeason();
  const coverage = await getSnapshotCoverage(season);
  const sp = await searchParams;
  const week = Number(sp.week) || coverage[0]?.week;

  if (!week) {
    return (
      <>
        <h1>Free agents</h1>
        <div className="card">
          <p className="empty">
            No ownership snapshots captured yet for {season}.
          </p>
          <p className="note">
            The weekly job writes one every Tuesday. The first snapshot gives a
            ranking; the second is when trends start working, because a trend
            needs two observations and there is no way to fake the first one.
          </p>
        </div>
      </>
    );
  }

  const [opportunities, pool] = await Promise.all([
    getPoolOpportunities(season, week),
    getPool(season, week),
  ]);

  const haveTrend = pool.some((p) => p.our_percent_change !== null);

  return (
    <>
      <h1>Free agents</h1>
      <p className="sub">
        {season} · week {week} · {pool.length} in the pool
      </p>

      {coverage.length > 1 && (
        <div className="tabs" style={{ padding: '0 0 10px' }}>
          {coverage.map((c) => (
            <a key={c.week} href={`/admin/pool?week=${c.week}`} className={c.week === week ? 'on' : ''}>
              Wk {c.week}
            </a>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Widely owned, still available</h2>
        <p className="note">
          Ranked by how much of ESPN owns them, not by projection. These are the
          players the rest of the platform rates that nobody here has claimed.
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Player</th><th>Pos</th><th>Owned</th><th>Started</th><th>Trend</th></tr>
            </thead>
            <tbody>
              {opportunities.map((p) => (
                <tr key={p.espn_player_id}>
                  <td>{p.full_name}</td>
                  <td className="tsub">{p.position}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(p.percent_owned)}</td>
                  <td className="tsub" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {pct(p.percent_started)}
                  </td>
                  <td>{delta(p.espn_percent_change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Full pool</h2>
        {!haveTrend && (
          <p className="note">
            The <em>ours</em> column is empty because this is the first snapshot of the
            season — a week-over-week change needs a previous week to compare against.
            It fills in from the next capture onward.
          </p>
        )}
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Player</th><th>Pos</th><th>Owned</th>
                <th>ESPN Δ</th><th>Ours Δ</th><th>$</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pool.map((p) => (
                <tr key={p.espn_player_id}>
                  <td>{p.full_name}</td>
                  <td className="tsub">{p.position}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(p.percent_owned)}</td>
                  <td>{delta(p.espn_percent_change)}</td>
                  <td>{delta(p.our_percent_change)}</td>
                  <td className="tsub" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {p.auction_value_avg === null ? '—' : Number(p.auction_value_avg).toFixed(1)}
                  </td>
                  <td className="tsub">{p.status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Status is whatever ESPN returned, uninterpreted. Every player observed so far
          has come back <code>WAIVERS</code>; <code>FREEAGENT</code> is requested by the
          filter but has never actually appeared in a response for this league, so it is
          not treated as a known value anywhere in the pipeline.
        </p>
      </div>
    </>
  );
}
