import {
  getCachedPreseasonTeams, getCachedSeasonList, getCachedSeasonTable,
} from '../../lib/cached-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';
import { EspnTeamLink } from '../../components/EspnLink.tsx';
import { SeasonPicker } from '../../components/SeasonPicker.tsx';
import { RecapArchive } from '../../components/RecapArchive.tsx';
import { franchiseHref, seasonHref } from '../../lib/history-format.ts';

export const dynamic = 'force-dynamic';

const PLAYOFF_FIELD = 6;

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
  const [seasons, current] = await Promise.all([getCachedSeasonList(), getCurrentSeason()]);
  const season = Number(sp.season) || current || seasons[0]?.season;
  if (!season) return <p className="empty">No seasons on record yet.</p>;

  const [rows, luck] = await getCachedSeasonTable(season);

  if (rows.length === 0) {
    const teams = await getCachedPreseasonTeams(season);
    if (teams.length === 0) return <p className="empty">Nothing on record for {season}.</p>;
    return (
      <>
        <div className="page-hero compact-hero">
          <div className="eyebrow">{season} season</div>
          <h1>The table</h1>
        </div>
        <div className="card">
          <div className="scroll">
            <table>
              <thead><tr><th className="rank">#</th><th>Team</th><th className="num">Record</th><th className="num">Games</th></tr></thead>
              <tbody>
                {teams.map((team, index) => (
                  <tr key={team.espn_team_id}>
                    <td className="rank">{index + 1}</td>
                    <td>
                      <a href={`/team/${team.espn_team_id}`} className="tname">{team.name}</a>
                      <EspnTeamLink teamId={team.espn_team_id} season={season} />
                    </td>
                    <td className="num">0-0</td>
                    <td className="num">{team.games}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Nobody has played yet, so this is the field and schedule rather than a completed historical table.</p>
        </div>
        <RecapArchive season={season} />
        <SeasonPicker seasons={seasons.map((x) => x.season)} current={season} basePath="/standings" />
      </>
    );
  }

  const luckBy = new Map(luck.map((row) => [row.espn_team_id, row]));
  const hasLuck = luck.length > 0;
  const archive = rows[0]!.source === 'manual';

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">{season} season</div>
        <h1>The table</h1>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <a className="btn btn-quiet" href={seasonHref(season)}>Open the {season} season file</a>
        <a className="btn btn-quiet" href="/history/records">League records</a>
      </div>

      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th className="rank">#</th><th>Team</th><th className="num">W-L</th>
                <th className="num">PF</th><th className="num">PA</th><th className="num">Playoffs</th>
                {hasLuck && <th className="num">Luck</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const luckRow = row.espn_team_id !== null ? luckBy.get(row.espn_team_id) : undefined;
                const delta = luckRow ? Number(luckRow.luck_delta) : 0;
                const result = finish(row.final_place);
                return (
                  <tr key={row.franchise_key}
                      className={row.is_champion ? 'title-row' : undefined}
                      style={index === PLAYOFF_FIELD - 1 ? { borderBottom: '2px solid var(--accent)' } : undefined}>
                    <td className="rank">{index + 1}</td>
                    <td>
                      <a href={franchiseHref(row.franchise_key)} className="tname">{row.team_name}</a>
                      {row.espn_team_id !== null && <EspnTeamLink teamId={row.espn_team_id} season={season} />}
                      {row.team_name !== row.current_name && <span className="tsub block">now {row.current_name}</span>}
                    </td>
                    <td className="num">{row.wins}-{row.losses}{row.ties ? `-${row.ties}` : ''}</td>
                    <td className="num">{row.points_for ?? '—'}</td>
                    <td className="num">{row.points_against ?? '—'}</td>
                    <td className="num">
                      {result ? (
                        <>
                          <span className={`pill ${row.is_champion ? 'w' : ''}`}>{row.playoff_wins}-{row.playoff_losses}</span>
                          <span className="tsub block">{result}</span>
                        </>
                      ) : '—'}
                    </td>
                    {hasLuck && (
                      <td className="num">
                        {luckRow ? (
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
          {hasLuck && <> <strong>Luck</strong> is wins above or below what your weekly scores earned against the whole league.</>}
          {archive && <> This season comes from the commissioner&rsquo;s 2005–2017 archive, which has no week-by-week luck index.</>}
        </p>
      </div>

      <RecapArchive season={season} />
      <SeasonPicker seasons={seasons.map((x) => x.season)} current={season} basePath="/standings" />
    </>
  );
}
