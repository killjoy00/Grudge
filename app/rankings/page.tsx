import {
  getCachedArchiveSeason,
  getCachedPlayedSeasons,
  getCachedPowerRankings,
  getCachedSeasonList,
} from '../../lib/cached-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';
import { legacyPowerRankings } from '../../pipeline/features.ts';
import { SeasonPicker } from '../../components/SeasonPicker.tsx';

export const dynamic = 'force-dynamic';

interface Components {
  winPct: number; pointsForPerGame: number; pointsAgainstPerGame: number;
  strengthOfSchedule: number; allPlayWinPct: number;
}

const MODERN_BLURB =
  '40% all-play record · 30% points per game · 20% actual record · 10% strength of schedule.';

/** One row of the bar chart, shared by both eras so they read identically. */
function Row({
  rank, name, espnTeamId, detail, pct,
}: {
  rank: number; name: string; espnTeamId: number | null; detail: string; pct: number;
}) {
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="rank">{rank}</span>
        {espnTeamId === null
          ? <span className="tname">{name}</span>
          : <a href={`/team/${espnTeamId}`} className="tname">{name}</a>}
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
  // The season the league is in, not the newest one with games in it. Power
  // rankings need results, so an unplayed season shows a preseason note rather
  // than silently serving last year's order as though it were current.
  //
  // The picker offers EVERY season on record, not just the ones with weekly
  // data. 2005-2017 are ranked from what the archive kept, below.
  const [played, allSeasons, current] = await Promise.all([
    getCachedPlayedSeasons(), getCachedSeasonList(), getCurrentSeason(),
  ]);
  const season = Number(sp.season) || current || played[0]?.season;
  if (!season) return <p className="empty">No completed seasons yet.</p>;

  const seasonChips = allSeasons.map((row) => row.season);
  const picker = (
    <SeasonPicker seasons={seasonChips} current={season} basePath="/rankings" />
  );

  const rows = await getCachedPowerRankings(season);

  // ------------------------------------------------------- the archive era
  //
  // Before 2018 there is no week-by-week feed, so power_rankings has nothing
  // for these years and never will. What the archive does keep is each team's
  // final record and its season points, which is enough for a ranking as long
  // as it says so rather than pretending to be the four-input model.
  if (rows.length === 0) {
    const table = await getCachedArchiveSeason(season);
    if (table.length > 0) {
      const ranked = legacyPowerRankings(table.map((t) => ({
        teamId: t.espn_team_id,
        franchiseKey: t.franchise_key,
        name: t.team_name,
        wins: t.wins, losses: t.losses, ties: t.ties,
        pointsFor: Number(t.points_for ?? 0),
      })));
      const top = ranked[0]?.score || 1;

      return (
        <>
          <div className="page-hero compact-hero">
            <div className="eyebrow">{season} · final</div>
            <h1>Power Rankings</h1>
            <p>
              70% points per game · 30% actual record. The week-by-week scores
              this season would need for the full model were never recorded, so
              this ranks the whole year from what the archive kept.
            </p>
          </div>

          <div className="card">
            {ranked.map((r) => (
              <Row key={r.franchiseKey} rank={r.rank} name={r.name} espnTeamId={r.teamId}
                   pct={(r.score / top) * 100}
                   detail={`${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''} · ` +
                           `${r.pointsForPerGame.toFixed(1)} ppg`} />
            ))}
          </div>

          <div className="card">
            <details>
              <summary>Why this season is ranked differently</summary>
              <p className="note" style={{ marginTop: 10 }}>
                From 2018 on, every team&rsquo;s score in every week is on file, so the
                ranking can ask what your record would have been against the whole
                league each week (all-play) and how hard your schedule was. Neither
                question can be answered for {season}: the archive is a season summary
                — final record, points for, points against — with no week detail
                behind it.
                <br /><br />
                Rather than feed those two inputs a neutral value and call it the same
                model, this uses only what actually exists. <strong>70% points per
                game, 30% win percentage.</strong> The modern model spends 70 of its
                100 points on scoring — all-play is a scoring measure wearing a
                record&rsquo;s clothes — and 20 on record; keeping that balance while
                dropping what cannot be computed lands close to 70/30, leaning a
                little toward record because record is the one thing these seasons are
                certain about.
                <br /><br />
                Points per game is scaled against the best team in that season, exactly
                as it is in the modern model, so the bars read the same way. Scores are
                not comparable across eras and are not meant to be — this ranks {season}
                {' '}against itself.
              </p>
            </details>
          </div>

          {picker}
        </>
      );
    }

    return (
      <>
        <div className="page-hero compact-hero">
          <div className="eyebrow">{season} season</div>
          <h1>Power Rankings</h1>
          <p>{MODERN_BLURB}</p>
        </div>
        <div className="callout">
          Every one of those inputs is a result, so there is nothing to rank
          until week 1 is in the books. Click below for previous seasons.
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
        <p>{MODERN_BLURB}</p>
      </div>

      <div className="card">
        {rows.map((r) => {
          const c = r.components as Components;
          return (
            <Row key={r.espn_team_id} rank={r.rank} name={r.name} espnTeamId={r.espn_team_id}
                 pct={(Number(r.score) / top) * 100}
                 detail={`${(c.allPlayWinPct * 100).toFixed(0)}% all-play · ` +
                         `${c.pointsForPerGame.toFixed(1)} ppg`} />
          );
        })}
      </div>

      <div className="card">
        <details>
          <summary>How this is calculated</summary>
          <p className="note" style={{ marginTop: 10 }}>
            40% all-play win percentage, 30% points per game, 20% actual win percentage,
            10% strength of schedule.
            <br /><br />
            All-play — your record if you played every team every week — is weighted
            highest deliberately. In a 10-team league, 14 games is far too short for
            record alone to separate a good team from a lucky one, which is exactly
            what the luck column on the standings page shows.
            <br /><br />
            Seasons before 2018 have no week-by-week scores, so all-play and strength
            of schedule cannot be computed for them. Those years are ranked on points
            per game and record alone, and say so.
          </p>
        </details>
      </div>

      {picker}
    </>
  );
}
