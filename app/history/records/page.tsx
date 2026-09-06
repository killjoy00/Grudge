import type { ReactNode } from 'react';

import { DraftRecordsSection } from '../../../components/DraftRecordsSection.tsx';
import { HistoryNav } from '../../../components/HistoryNav.tsx';
import { getDraftRecords } from '../../../lib/draft-records.ts';
import { getCachedHistoryRecords } from '../../../lib/history-cache.ts';
import { franchiseHref, managerHref, pointsPerGame, record, seasonHref, winRate } from '../../../lib/history-format.ts';
import type { AllSeasonRecordRow, MatchupRecordRow } from '../../../lib/history-queries.ts';
import {
  getFinalPowerSeasonRecords,
  getLuckiestSeasons,
  getPowerRankingChampions,
  getUnluckiestSeasons,
  type PowerSeasonRecordRow,
  type SeasonLuckRecordRow,
} from '../../../lib/history-record-insights.ts';
import { getTrackedTopPlayerWeeks, getTrackedTopScoringWeeks } from '../../../lib/tracked-game-queries.ts';
import { POSITIONS } from '../../../pipeline/trade.ts';

export const dynamic = 'force-dynamic';

const POWER_FORMULA = '40% all-play record · 30% points per game · 20% actual record · 10% strength of schedule';

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

function powerScore(score: string) {
  return (Number(score) * 100).toFixed(1);
}

function SeasonTable({ rows, value, markLabel = 'Mark' }: {
  rows: AllSeasonRecordRow[];
  value: (row: AllSeasonRecordRow) => ReactNode;
  markLabel?: string;
}) {
  return (
    <div className="card"><div className="scroll"><table>
      <thead><tr><th className="rank">#</th><th>Season</th><th>Franchise</th><th>Manager</th><th className="num">Record</th><th className="num">{markLabel}</th></tr></thead>
      <tbody>{rows.map((row, index) => (
        <tr key={`${row.season}-${row.franchise_key}`} className={row.is_champion ? 'title-row' : undefined}>
          <td className="rank">{index + 1}</td>
          <td><a className="tname" href={seasonHref(row.season)}>{row.season}</a></td>
          <td><a href={franchiseHref(row.franchise_key)}>{row.team_name}</a>{row.is_champion && <span className="tag best">Champion</span>}</td>
          <td>{row.manager_key && row.manager ? <a href={managerHref(row.manager_key)}>{row.manager}</a> : '—'}</td>
          <td className="num">{record(row.wins, row.losses, row.ties)}</td>
          <td className="num"><strong>{value(row)}</strong></td>
        </tr>
      ))}</tbody>
    </table></div></div>
  );
}

function PowerSeasonTable({ rows }: { rows: PowerSeasonRecordRow[] }) {
  return (
    <div className="card"><div className="scroll"><table>
      <thead><tr><th className="rank">#</th><th>Season</th><th>Franchise</th><th>Manager</th><th className="num">Record</th><th className="num">Power</th></tr></thead>
      <tbody>{rows.map((row, index) => (
        <tr key={`${row.season}-${row.franchise_key}`} className={row.is_champion ? 'title-row' : undefined}>
          <td className="rank">{index + 1}</td>
          <td><a className="tname" href={`/rankings?season=${row.season}`}>{row.season}</a></td>
          <td><a href={franchiseHref(row.franchise_key)}>{row.team_name}</a>{row.is_champion && <span className="tag best">Champion</span>}</td>
          <td>{row.manager_key && row.manager ? <a href={managerHref(row.manager_key)}>{row.manager}</a> : '—'}</td>
          <td className="num">{record(row.wins, row.losses, row.ties)}</td>
          <td className="num"><strong>{powerScore(row.score)}</strong><span className="tsub block">#{row.rank} that season</span></td>
        </tr>
      ))}</tbody>
    </table></div></div>
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
      <h3 style={{ marginBottom: 6 }}><a href={franchiseHref(row.franchise_key)}>{row.team_name}</a></h3>
      <strong>{detail(row)}</strong>
      <p className="note" style={{ marginBottom: 0 }}>
        <a href={seasonHref(row.season)}>{row.season} week {row.week}</a> vs. {row.opponent_name}{row.playoff_tier ? ' · postseason' : ''}
      </p>
    </div>
  );
}

function LuckTable({ title, rows }: { title: string; rows: SeasonLuckRecordRow[] }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="scroll"><table>
        <thead><tr><th>#</th><th>Season</th><th>Team</th><th className="num">Actual W</th><th className="num">Expected W</th><th className="num">Delta</th></tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={`${row.season}-${row.franchise_key}`}>
            <td>{index + 1}</td>
            <td><a href={seasonHref(row.season)}>{row.season}</a></td>
            <td><a className="tname" href={franchiseHref(row.franchise_key)}>{row.team_name}</a>{row.manager_key && row.manager && <span className="tsub block"><a href={managerHref(row.manager_key)}>{row.manager}</a></span>}</td>
            <td className="num">{row.actual_wins}</td><td className="num">{row.expected_wins}</td>
            <td className="num"><strong>{Number(row.luck_delta) > 0 ? '+' : ''}{row.luck_delta}</strong></td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

export default async function RecordsPage() {
  const [[seasons, games], topWeeks, topPlayers, powerSeasons, powerChampions, luckiest, unluckiest, draftRecords] = await Promise.all([
    getCachedHistoryRecords(),
    getTrackedTopScoringWeeks(10),
    getTrackedTopPlayerWeeks(10),
    getFinalPowerSeasonRecords(),
    getPowerRankingChampions(),
    getLuckiestSeasons(10),
    getUnluckiestSeasons(10),
    getDraftRecords(),
  ]);
  const eligible = seasons.filter((row) => row.points_for !== null);
  const bestSeasons = [...eligible].sort(bySeasonQuality).slice(0, 10);
  const offenses = [...eligible].sort(byOffense).slice(0, 10);
  const champions = powerSeasons.filter((row) => row.is_champion).slice(0, 10);
  const nonChampions = powerSeasons.filter((row) => !row.is_champion).slice(0, 10);
  const missedPlayoffs = powerSeasons
    .filter((row) => row.final_place !== null && row.final_place > row.playoff_team_count)
    .slice(0, 10);

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The record book</div>
        <h1>League records</h1>
        <p>Season achievements, game marks, draft archaeology, power champions and schedule luck in one place.</p>
      </div>

      <HistoryNav current="records" />

      <h2>Season records</h2>
      <h3>Highest win percentage</h3>
      <p className="sub">Regular-season win percentage; PF/G breaks ties so 12-, 13- and 14-game schedules compare fairly.</p>
      <SeasonTable rows={bestSeasons} markLabel="Win %" value={(row) => `${(winRate(row.wins, row.losses, row.ties) * 100).toFixed(1)}%`} />

      <h3>Best offenses</h3>
      <p className="sub">Points per regular-season game, not raw season totals.</p>
      <SeasonTable rows={offenses} markLabel="PF/G" value={(row) => `${pointsPerGame(row.points_for, row.wins, row.losses, row.ties)?.toFixed(1) ?? '—'}`} />

      <h3>Best champions</h3>
      <p className="sub">Final regular-season power score: {POWER_FORMULA}. Every season from 2005 onward uses the same model.</p>
      <PowerSeasonTable rows={champions} />

      <h3>Best teams that did not win it</h3>
      <p className="sub">Highest final regular-season power scores among non-champions.</p>
      <PowerSeasonTable rows={nonChampions} />

      <h3>Best teams to miss the playoffs</h3>
      <p className="sub">Highest final regular-season power scores among teams that finished outside that season&rsquo;s playoff field.</p>
      <PowerSeasonTable rows={missedPlayoffs} />

      <h2>Single-game team records</h2>
      <p className="sub">Recovered team-level weekly scoreboards cover 2005 onward. Regular-season and championship-bracket games count; consolation placement games do not.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <GameRecord label="Highest score" row={games.highestScore} detail={(row) => `${row.points_for} points`} />
        <GameRecord label="Lowest score" row={games.lowestScore} detail={(row) => `${row.points_for} points`} />
        <GameRecord label="Highest-scoring loss" row={games.highestScoringLoss} detail={(row) => `${row.points_for}–${row.points_against}`} />
        <GameRecord label="Lowest-scoring win" row={games.lowestScoringWin} detail={(row) => `${row.points_for}–${row.points_against}`} />
        <GameRecord label="Highest combined score" row={games.highestCombinedScore} detail={(row) => `${row.points_for}–${row.points_against} (${(Number(row.points_for) + Number(row.points_against)).toFixed(1)} combined)`} />
        <GameRecord label="Biggest blowout" row={games.biggestBlowout} detail={(row) => `${row.points_for}–${row.points_against} (+${Math.abs(Number(row.margin)).toFixed(1)})`} />
        <GameRecord label="Closest finish" row={games.closestFinish} detail={(row) => `${row.points_for}–${row.points_against} (${Math.abs(Number(row.margin)).toFixed(1)} points)`} />
      </div>

      <h2>Highest team scores</h2>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>#</th><th>Team</th><th className="num">Points</th><th>Week</th><th>Opponent</th></tr></thead>
        <tbody>{topWeeks.map((row, index) => (
          <tr key={`${row.season}-${row.week}-${row.espn_team_id}`} className={index === 0 ? 'title-row' : undefined}>
            <td>{index + 1}</td><td><a className="tname" href={`/team/${row.espn_team_id}`}>{row.name}</a></td>
            <td className="num"><strong>{row.points}</strong></td>
            <td><a href={seasonHref(row.season)}>{row.season} wk {row.week}</a>{row.playoff_tier && <span className="tag era">postseason</span>}</td>
            <td>{row.opponent ?? '—'}<span className="tsub block">{row.result ?? ''} {row.points}-{row.points_against}</span></td>
          </tr>
        ))}</tbody>
      </table></div></div>

      <h2>Highest individual player weeks</h2>
      <p className="sub">Player-level lineup entries survive from 2018 onward. Bench performances are intentionally included and labeled.</p>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>#</th><th>Player</th><th>Team</th><th className="num">Points</th><th>Week</th><th>Lineup</th></tr></thead>
        <tbody>{topPlayers.map((row, index) => (
          <tr key={`${row.season}-${row.week}-${row.espn_player_id}`} className={index === 0 ? 'title-row' : undefined}>
            <td>{index + 1}</td>
            <td><span className="tname">{row.full_name ?? `ESPN player #${row.espn_player_id}`}</span><span className="tsub block">{POSITIONS[row.default_position_id ?? 0] ?? '—'}</span></td>
            <td><a href={`/team/${row.espn_team_id}`}>{row.team}</a></td>
            <td className="num"><strong>{row.points}</strong></td>
            <td><a href={seasonHref(row.season)}>{row.season} wk {row.week}</a>{row.playoff_tier && <span className="tag era">postseason</span>}</td>
            <td>{row.is_starter ? 'Starter' : <span className="tag worst">Bench</span>}</td>
          </tr>
        ))}</tbody>
      </table></div></div>

      <DraftRecordsSection records={draftRecords} />

      <h2>Power-ranking champions</h2>
      <p className="sub">The team ranked #1 after the final regular-season week, using the same current 40/30/20/10 formula in every recoverable season.</p>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Season</th><th>Team</th><th>Manager</th><th className="num">Power</th></tr></thead>
        <tbody>{powerChampions.map((row) => (
          <tr key={row.season}>
            <td><a className="tname" href={`/rankings?season=${row.season}`}>{row.season}</a></td>
            <td><a href={franchiseHref(row.franchise_key)}>{row.team_name}</a></td>
            <td>{row.manager_key && row.manager ? <a href={managerHref(row.manager_key)}>{row.manager}</a> : '—'}</td>
            <td className="num">{powerScore(row.score)}</td>
          </tr>
        ))}</tbody>
      </table></div></div>

      <h2>Schedule luck</h2>
      <p className="sub">Actual regular-season wins minus all-play expected wins. Positive means the schedule helped; negative means it hurt.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <LuckTable title="Luckiest seasons" rows={luckiest} />
        <LuckTable title="Unluckiest seasons" rows={unluckiest} />
      </div>
    </>
  );
}
