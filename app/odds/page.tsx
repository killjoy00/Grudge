import { getCachedPlayedSeasons, getCachedPlayoffOdds } from '../../lib/cached-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';
import { SeasonPicker } from '../../components/SeasonPicker.tsx';

export const dynamic = 'force-dynamic';

export default async function Odds({
  searchParams,
}: { searchParams: Promise<{ season?: string }> }) {
  const sp = await searchParams;
  // The season the league is in, not the newest one with games in it. Same trap
  // the standings and rankings pages fell into: odds are simulated FROM
  // results, so "newest with results" is last year for the whole preseason.
  const [seasons, current] = await Promise.all([getCachedPlayedSeasons(), getCurrentSeason()]);
  const season = Number(sp.season) || current || seasons[0]?.season;
  if (!season) return <p className="empty">No completed seasons yet.</p>;

  const rows = await getCachedPlayoffOdds(season);

  if (rows.length === 0) {
    return (
      <>
        <div className="page-hero compact-hero">
          <div className="eyebrow">{season} season</div>
          <h1>The path in</h1>
          <p>Simulations of the remaining schedule under the league&rsquo;s real tiebreak rules.</p>
        </div>
        <div className="callout">
          With no games played, every team&rsquo;s remaining schedule is the whole
          season and the simulation would just be telling you the field is even.
          Odds appear once week 1 is scored. Click below for previous seasons.
        </div>
        <SeasonPicker seasons={seasons.map((x) => x.season)} current={season}
                      basePath="/odds" />
      </>
    );
  }

  const a = (rows[0]?.assumptions ?? {}) as Record<string, unknown>;

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">{season} · after week {rows[0]?.week ?? '—'}</div>
        <h1>The path in</h1>
        <p>{String(a.simCount ?? '')} simulations of the remaining schedule and real tiebreak rules.</p>
      </div>

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

      <SeasonPicker seasons={seasons.map((x) => x.season)} current={season}
                    basePath="/odds" />
    </>
  );
}
