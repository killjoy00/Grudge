import { getCachedPlayoffOdds } from '../../lib/cached-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';

export const dynamic = 'force-dynamic';

/**
 * Playoff odds, current season only.
 *
 * THERE IS DELIBERATELY NO SEASON PICKER HERE, and this is the one page on the
 * site where that is right. Every other page answers a question that stays
 * interesting once a season is over -- who won, who scored most, who beat
 * whom. This page answers "who is going to make the playoffs", and for a
 * finished season that is not a projection, it is a fact you can look up on
 * the standings. A 2024 row reading "83% to make the playoffs" next to a team
 * that either did or did not is noise dressed as analysis.
 *
 * Historical playoff_odds rows are left in the database untouched -- the recap
 * joins them for its power-rankings block. They are simply not offered here.
 */
export default async function Odds() {
  const season = await getCurrentSeason();
  if (!season) return <p className="empty">No season is under way.</p>;

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
          Odds appear once week 1 is scored.
        </div>
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
            <br /><br />
            Only the current season appears here. Odds for a finished season are
            not a projection — the standings already tell you who got in.
          </p>
        </details>
      </div>
    </>
  );
}
