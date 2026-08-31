import { getCachedPlayedSeasons, getCachedPowerRankings } from '../../lib/cached-queries.ts';

export const dynamic = 'force-dynamic';

interface Components {
  winPct: number; pointsForPerGame: number; pointsAgainstPerGame: number;
  strengthOfSchedule: number; allPlayWinPct: number;
}

export default async function Rankings({
  searchParams,
}: { searchParams: Promise<{ season?: string }> }) {
  const seasons = await getCachedPlayedSeasons();
  const sp = await searchParams;
  const season = Number(sp.season) || seasons[0]?.season;
  if (!season) return <p className="empty">No completed seasons yet.</p>;

  const rows = await getCachedPowerRankings(season);
  const top = rows[0] ? Number(rows[0].score) : 1;

  return (
    <>
      <h1>Power rankings</h1>
      <p className="sub">{season} · through week {rows[0]?.week ?? '—'}</p>

      <div className="card">
        {rows.map((r) => {
          const c = r.components as Components;
          const pct = (Number(r.score) / top) * 100;
          return (
            <div key={r.espn_team_id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="rank">{r.rank}</span>
                <a href={`/team/${r.espn_team_id}`} className="tname">{r.name}</a>
                <span className="spacer" style={{ flex: 1 }} />
                <span className="tsub" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {(c.allPlayWinPct * 100).toFixed(0)}% all-play · {c.pointsForPerGame.toFixed(1)} ppg
                </span>
              </div>
              <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <details>
          <summary>How this is calculated</summary>
          <p className="note" style={{ marginTop: 10 }}>
            45% all-play win percentage, 30% points per game, 15% actual win percentage,
            10% strength of schedule.
            <br /><br />
            All-play — your record if you played every team every week — is weighted
            highest deliberately. In a 10-team league, 14 games is far too short for
            record alone to separate a good team from a lucky one, which is exactly
            what the luck column on the standings page shows.
          </p>
        </details>
      </div>
    </>
  );
}
