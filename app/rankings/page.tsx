import {
  getCachedPlayedSeasons,
  getCachedPowerRankings,
  getCachedSeasonList,
} from '../../lib/cached-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';
import { SeasonPicker } from '../../components/SeasonPicker.tsx';

export const dynamic = 'force-dynamic';

interface Components {
  winPct: number;
  pointsForPerGame: number;
  pointsAgainstPerGame: number;
  strengthOfSchedule: number;
  allPlayWinPct: number;
}

const FORMULA = '40% all-play record · 30% points per game · 20% actual record · 10% strength of schedule.';

function Row({ rank, name, espnTeamId, detail, pct }: {
  rank: number;
  name: string;
  espnTeamId: number;
  detail: string;
  pct: number;
}) {
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="rank">{rank}</span>
        <a href={`/team/${espnTeamId}`} className="tname">{name}</a>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="tsub" style={{ fontVariantNumeric: 'tabular-nums' }}>{detail}</span>
      </div>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default async function Rankings({
  searchParams,
}: { searchParams: Promise<{ season?: string }> }) {
  const sp = await searchParams;
  const [played, allSeasons, current] = await Promise.all([
    getCachedPlayedSeasons(),
    getCachedSeasonList(),
    getCurrentSeason(),
  ]);
  const season = Number(sp.season) || current || played[0]?.season;
  if (!season) return <p className="empty">No completed seasons yet.</p>;

  const seasonChips = allSeasons.map((row) => row.season);
  const picker = <SeasonPicker seasons={seasonChips} current={season} basePath="/rankings" />;
  const rows = await getCachedPowerRankings(season);

  if (rows.length === 0) {
    return (
      <>
        <div className="page-hero compact-hero">
          <div className="eyebrow">{season} season</div>
          <h1>Power Rankings</h1>
          <p>{FORMULA}</p>
        </div>
        <div className="callout">
          {season === current
            ? 'Every input is a result, so the current season has nothing to rank until week 1 is in the books.'
            : 'This season has a scoreboard on file, but its derived ranking has not been loaded yet.'}
        </div>
        {picker}
      </>
    );
  }

  const top = rows[0] ? Number(rows[0].score) : 1;

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">{season} · through week {rows[0]?.week ?? '—'}</div>
        <h1>Power Rankings</h1>
        <p>{FORMULA}</p>
      </div>

      <div className="card">
        {rows.map((row) => {
          const components = row.components as Components;
          return (
            <Row
              key={row.espn_team_id}
              rank={row.rank}
              name={row.name}
              espnTeamId={row.espn_team_id}
              pct={(Number(row.score) / top) * 100}
              detail={`${(components.allPlayWinPct * 100).toFixed(0)}% all-play · ${components.pointsForPerGame.toFixed(1)} ppg`}
            />
          );
        })}
      </div>

      <div className="card">
        <details>
          <summary>How this is calculated</summary>
          <p className="note" style={{ marginTop: 10 }}>
            <strong>Every season uses the same model:</strong> 40% all-play win percentage,
            30% points per game, 20% actual win percentage, and 10% strength of schedule.
            <br /><br />
            All-play asks what your record would have been against every team each week.
            Strength of schedule is the average all-play strength of the opponents you actually faced.
            Points per game is scaled to that season&rsquo;s highest-scoring team, so scoring-era inflation
            does not give newer seasons a different formula.
            <br /><br />
            ESPN&rsquo;s recovered 2005–2017 scoreboards contain every team score and opponent,
            which is enough to reconstruct all four inputs exactly. Player-level lineup details are
            missing in those seasons, but they are not part of the power-ranking formula.
          </p>
        </details>
      </div>

      {picker}
    </>
  );
}
