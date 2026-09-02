import {
  getCachedPreseasonTeams, getCachedSeasonList, getCachedSeasonTable,
} from '../../lib/cached-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';

// Render after deployment, then cache the underlying public data for an hour.
export const dynamic = 'force-dynamic';

const PLAYOFF_FIELD = 6;

/** How a finish reads once the bracket is over. */
function finish(place: number | null) {
  if (place === 1) return 'Champion';
  if (place === 2) return 'Runner-up';
  if (place === 3 || place === 4) return 'Lost semifinal';
  if (place === 5 || place === 6) return 'Lost first round';
  return null;
}

export default async function Standings({
  searchParams,
}: { searchParams: Promise<{ season?: string }> }) {
  const sp = await searchParams;
  // Default to the season the league is actually IN, not the newest one with
  // results. franchise_seasons is written from results, so through the whole
  // preseason "newest with results" is last year -- which is how this page
  // spent the summer presenting a finished season as the current table.
  const [seasons, current] = await Promise.all([getCachedSeasonList(), getCurrentSeason()]);
  const season = Number(sp.season) || current || seasons[0]?.season;
  if (!season) return <p className="empty">No seasons on record yet.</p>;

  const [rows, luck] = await getCachedSeasonTable(season);

  if (rows.length === 0) {
    const teams = await getCachedPreseasonTeams(season);
    if (teams.length === 0) {
      return <p className="empty">Nothing on record for {season}.</p>;
    }
    const previous = seasons.find((s) => s.season < season)?.season;
    return (
      <>
        <div className="page-hero compact-hero">
          <div className="eyebrow">{season} season</div>
          <h1>The table</h1>
        </div>
        <div className="card">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="rank">#</th><th>Team</th>
                  <th className="num">Record</th><th className="num">Games</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t, i) => (
                  <tr key={t.espn_team_id}>
                    <td className="rank">{i + 1}</td>
                    <td><a href={`/team/${t.espn_team_id}`} className="tname">{t.name}</a></td>
                    <td className="num">0-0</td>
                    <td className="num">{t.games}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Nobody has played yet, so this is the field and the schedule rather
            than a table.{' '}
            {previous && <a href={`/standings?season=${previous}`}>See {previous}</a>}
          </p>
        </div>
      </>
    );
  }

  const luckBy = new Map(luck.map((l) => [l.espn_team_id, l]));
  const hasLuck = luck.length > 0;
  const archive = rows[0]!.source === 'manual';

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">{season} season</div>
        <h1>The table</h1>
      </div>

      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th className="rank">#</th>
                <th>Team</th>
                <th className="num">W-L</th>
                <th className="num">PF</th>
                <th className="num">PA</th>
                <th className="num">Playoffs</th>
                {hasLuck && <th className="num">Luck</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const l = r.espn_team_id !== null ? luckBy.get(r.espn_team_id) : undefined;
                const delta = l ? Number(l.luck_delta) : 0;
                const result = finish(r.final_place);
                return (
                  <tr key={r.franchise_key}
                      className={r.is_champion ? 'title-row' : undefined}
                      style={i === PLAYOFF_FIELD - 1 ? { borderBottom: '2px solid var(--accent)' } : undefined}>
                    <td className="rank">{i + 1}</td>
                    <td>
                      {r.espn_team_id !== null ? (
                        <a href={`/team/${r.espn_team_id}`} className="tname">{r.team_name}</a>
                      ) : (
                        <span className="tname">{r.team_name}</span>
                      )}
                      {r.team_name !== r.current_name && (
                        <span className="tsub block">now {r.current_name}</span>
                      )}
                    </td>
                    <td className="num">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</td>
                    <td className="num">{r.points_for ?? '—'}</td>
                    <td className="num">{r.points_against ?? '—'}</td>
                    <td className="num">
                      {result ? (
                        <>
                          <span className={`pill ${r.is_champion ? 'w' : ''}`}>
                            {r.playoff_wins}-{r.playoff_losses}
                          </span>
                          <span className="tsub block">{result}</span>
                        </>
                      ) : '—'}
                    </td>
                    {hasLuck && (
                      <td className="num">
                        {l ? (
                          <span className={`pill ${delta > 0.5 ? 'warn' : delta < -0.5 ? 'l' : ''}`}>
                            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                          </span>
                        ) : '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 12 }}>
          The blue line is the playoff cut (top {PLAYOFF_FIELD} of {rows.length}).
          {hasLuck && (
            <> <strong>Luck</strong> is wins above or below what your weekly scores
            earned against the whole league — positive means the schedule was kind.</>
          )}
          {archive && (
            <> This season comes from the commissioner&rsquo;s 2005–2017 archive: season
            totals and a playoff finish order, with no week-by-week scores, so
            there is no luck index.</>
          )}
        </p>
      </div>

      {seasons.length > 1 && (
        <div className="card">
          <strong style={{ fontSize: 14 }}>Other seasons</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {seasons.map((s) => (
              <a key={s.season} href={`/standings?season=${s.season}`}
                 className={`btn${s.season === season ? '' : ' btn-quiet'}`}
                 style={{ padding: '6px 12px' }}>
                {s.season}
              </a>
            ))}
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            The league did not play in 2020.
          </p>
        </div>
      )}
    </>
  );
}
