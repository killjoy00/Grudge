import { getPlayoffOdds, getPlayedSeasons } from '../../lib/queries.ts';

export const revalidate = 3600;

export default async function Odds({
  searchParams,
}: { searchParams: Promise<{ season?: string }> }) {
  const seasons = await getPlayedSeasons();
  const sp = await searchParams;
  const season = Number(sp.season) || seasons[0]?.season;
  if (!season) return <p className="empty">No completed seasons yet.</p>;

  const rows = await getPlayoffOdds(season);
  const a = (rows[0]?.assumptions ?? {}) as Record<string, unknown>;

  return (
    <>
      <h1>Playoff odds</h1>
      <p className="sub">
        {season} · after week {rows[0]?.week ?? '—'} · {String(a.simCount ?? '')} simulations
      </p>

      <div className="card">
        {rows.map((r) => (
          <div key={r.espn_team_id} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <a href={`/team/${r.espn_team_id}`} className="tname">{r.name}</a>
              <span style={{ flex: 1 }} />
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                {r.playoff_pct}%
              </span>
              {Number(r.bye_pct) > 0.5 && (
                <span className="tsub" style={{ minWidth: 62, textAlign: 'right' }}>
                  bye {r.bye_pct}%
                </span>
              )}
            </div>
            <div className="bar"><i style={{ width: `${r.playoff_pct}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="card">
        <details>
          <summary>What these numbers assume — and how well they&rsquo;ve held up</summary>
          <p className="note" style={{ marginTop: 10 }}>
            Each remaining game is simulated by drawing both teams&rsquo; scores from a
            normal distribution fitted to their own weeks this season, then re-seeding
            on the league&rsquo;s real rule (win %, ties broken by total points).
            <br /><br />
            <strong>Each team&rsquo;s average is pulled toward the league average</strong>
            {' '}before simulating. That is not a fudge: the raw model was checked
            against seven real seasons and was measurably overconfident — teams it
            gave a 30% chance made the playoffs 46% of the time. Shrinking the means
            cut the average error from 4.9 points to 0.8.
            <br /><br />
            <strong>What it ignores:</strong> injuries, bye weeks, trades, waiver
            pickups, and hot streaks. Weeks are drawn independently. So treat a 95%
            as &ldquo;very likely&rdquo;, not a promise.
          </p>
        </details>
      </div>
    </>
  );
}
