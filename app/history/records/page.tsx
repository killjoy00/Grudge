import type { ReactNode } from 'react';

import { getCachedHistoryRecords } from '../../../lib/history-cache.ts';
import { franchiseHref, managerHref, pointsPerGame, record, seasonHref, winRate } from '../../../lib/history-format.ts';
import type { AllSeasonRecordRow, MatchupRecordRow } from '../../../lib/history-queries.ts';

export const revalidate = 86400;

function bySeasonQuality(a: AllSeasonRecordRow, b: AllSeasonRecordRow) {
  const rate = winRate(b.wins, b.losses, b.ties) - winRate(a.wins, a.losses, a.ties);
  if (rate) return rate;
  return (pointsPerGame(b.points_for, b.wins, b.losses, b.ties) ?? 0)
    - (pointsPerGame(a.points_for, a.wins, a.losses, a.ties) ?? 0);
}

function byOffense(a: AllSeasonRecordRow, b: AllSeasonRecordRow) {
  return (pointsPerGame(b.points_for, b.wins, b.losses, b.ties) ?? 0)
    - (pointsPerGame(a.points_for, a.wins, a.losses, a.ties) ?? 0);
}

function SeasonTable({ rows, value }: {
  rows: AllSeasonRecordRow[];
  value: (row: AllSeasonRecordRow) => ReactNode;
}) {
  return (
    <div className="card">
      <div className="scroll">
        <table>
          <thead><tr><th className="rank">#</th><th>Season</th><th>Franchise</th><th>Manager</th><th className="num">Record</th><th className="num">Mark</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.season}-${row.franchise_key}`} className={row.is_champion ? 'title-row' : undefined}>
                <td className="rank">{index + 1}</td>
                <td><a className="tname" href={seasonHref(row.season)}>{row.season}</a></td>
                <td>
                  <a href={franchiseHref(row.franchise_key)}>{row.team_name}</a>
                  {row.is_champion && <span className="tag best">Champion</span>}
                </td>
                <td>
                  {row.manager_key && row.manager
                    ? <a href={managerHref(row.manager_key)}>{row.manager}</a>
                    : '—'}
                </td>
                <td className="num">{record(row.wins, row.losses, row.ties)}</td>
                <td className="num"><strong>{value(row)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GameRecord({ label, row, detail }: {
  label: string;
  row: MatchupRecordRow | null;
  detail: (row: MatchupRecordRow) => string;
}) {
  if (!row) return null;
  return (
    <div className="card">
      <span className="eyebrow">{label}</span>
      <h3 style={{ marginBottom: 6 }}>
        <a href={franchiseHref(row.franchise_key)}>{row.team_name}</a>
      </h3>
      <strong>{detail(row)}</strong>
      <p className="note" style={{ marginBottom: 0 }}>
        <a href={seasonHref(row.season)}>{row.season} week {row.week}</a> vs. {row.opponent_name}
        {row.playoff_tier ? ' · postseason' : ''}
      </p>
    </div>
  );
}

export default async function RecordsPage() {
  const [seasons, games] = await getCachedHistoryRecords();
  const eligible = seasons.filter((row) => row.points_for !== null);
  const bestSeasons = [...eligible].sort(bySeasonQuality).slice(0, 10);
  const offenses = [...eligible].sort(byOffense).slice(0, 10);
  const champions = seasons.filter((row) => row.is_champion).sort(bySeasonQuality).slice(0, 10);
  const nonChampions = seasons.filter((row) => !row.is_champion).sort(bySeasonQuality).slice(0, 10);
  const missedPlayoffs = seasons.filter((row) => row.final_place !== null && row.final_place > 6).sort(bySeasonQuality).slice(0, 10);

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The record book</div>
        <h1>League records</h1>
        <p>Great seasons across every era, plus single-game marks where weekly ESPN data exists.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        <a className="btn btn-quiet" href="/history">← League history</a>
      </div>

      <h2>Best regular seasons</h2>
      <p className="sub">Ranked by win percentage, then points per game so 12-, 13- and 14-game schedules compare fairly.</p>
      <SeasonTable rows={bestSeasons} value={(row) => `${(winRate(row.wins, row.losses, row.ties) * 100).toFixed(1)}%`} />

      <h2>Best offenses</h2>
      <p className="sub">Points per regular-season game, not raw season totals.</p>
      <SeasonTable rows={offenses} value={(row) => `${pointsPerGame(row.points_for, row.wins, row.losses, row.ties)?.toFixed(1) ?? '—'} PF/G`} />

      <h2>Best champions</h2>
      <SeasonTable rows={champions} value={(row) => `${(winRate(row.wins, row.losses, row.ties) * 100).toFixed(1)}%`} />

      <h2>Best teams that did not win it</h2>
      <SeasonTable rows={nonChampions} value={(row) => `${(winRate(row.wins, row.losses, row.ties) * 100).toFixed(1)}%`} />

      <h2>Best teams to miss the playoffs</h2>
      <SeasonTable rows={missedPlayoffs} value={(row) => `${(winRate(row.wins, row.losses, row.ties) * 100).toFixed(1)}%`} />

      <h2>Single-game records</h2>
      <p className="sub">ESPN era only. Playoff and consolation games count because they are real scored matchups.</p>
      <div style={{ display: 'grid', gap: 14 }}>
        <GameRecord label="Highest score" row={games.highestScore} detail={(row) => `${row.points_for} points`} />
        <GameRecord label="Lowest score" row={games.lowestScore} detail={(row) => `${row.points_for} points`} />
        <GameRecord label="Highest-scoring loss" row={games.highestScoringLoss} detail={(row) => `${row.points_for}–${row.points_against}`} />
        <GameRecord label="Biggest blowout" row={games.biggestBlowout} detail={(row) => `${row.points_for}–${row.points_against} (+${Math.abs(Number(row.margin)).toFixed(1)})`} />
        <GameRecord label="Closest finish" row={games.closestFinish} detail={(row) => `${row.points_for}–${row.points_against} (${Math.abs(Number(row.margin)).toFixed(1)} points)`} />
      </div>
    </>
  );
}
