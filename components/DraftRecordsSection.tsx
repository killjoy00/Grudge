import { franchiseHref, managerHref } from '../lib/history-format.ts';
import type { DraftClassRow, DraftPickValueRow, DraftRecords } from '../lib/draft-records.ts';
import { POSITIONS } from '../pipeline/trade.ts';
import { playerHref } from '../lib/player-data.ts';

const signed = (value: number | string) => {
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
};

const positionLabel = (positionId: number | null | undefined) =>
  POSITIONS[positionId ?? 0] ?? (positionId == null ? '—' : `Pos. ${positionId}`);

function sourceLabel(source: string) {
  if (source === 'espn_exact') return 'ESPN season total';
  if (source === 'espn_weekly') return 'ESPN weekly archive';
  if (source === 'nflverse' || source === 'nflverse_id' || source === 'nflverse_name') return 'reconstructed';
  if (source === 'espn_nflverse') return 'ESPN + reconstructed weeks';
  if (source === 'no_regular_season_stats') return 'verified no NFL stats';
  return source;
}

function ClassTable({ title, rows }: { title: string; rows: DraftClassRow[] }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="scroll"><table>
        <thead><tr><th>#</th><th>Draft</th><th>Manager</th><th className="num">Value</th><th className="num">Picks</th></tr></thead>
        <tbody>{rows.slice(0, 10).map((row, index) => (
          <tr key={`${title}-${row.season}-${row.franchise_key}`}>
            <td>{index + 1}</td>
            <td>
              <a className="tname" href={`/history/vault/${row.season}#draft`}>{row.season} {row.team_name}</a>
              <span className="tsub block">{row.fantasy_points} drafted-player fantasy points</span>
            </td>
            <td>{row.manager_key && row.manager ? <a href={managerHref(row.manager_key)}>{row.manager}</a> : '—'}</td>
            <td className="num"><strong>{signed(row.avg_value_delta)}</strong><span className="tsub block">value points</span></td>
            <td className="num">{row.graded_picks}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

function PickTable({ title, rows, positive }: { title: string; rows: DraftPickValueRow[]; positive: boolean }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="scroll"><table>
        <thead><tr><th>#</th><th>Player</th><th>Drafted by</th><th className="num">Value</th><th className="num">Points</th></tr></thead>
        <tbody>{rows.slice(0, 10).map((row, index) => (
          <tr key={`${title}-${row.season}-${row.overall_pick}`}>
            <td>{index + 1}</td>
            <td>
              <a className="tname" href={playerHref(row.player_key, row.season)}>{row.full_name ?? row.player_key}</a>
              <span className="tsub block">{positionLabel(row.default_position_id)} · {row.season} R{row.round} P{row.round_pick} (#{row.overall_pick})</span>
              {row.active_weeks !== null && <span className="tsub block">Scored in {row.active_weeks} weeks</span>}
            </td>
            <td><a href={franchiseHref(row.franchise_key)}>{row.team_name}</a>{row.manager_key && row.manager && <span className="tsub block"><a href={managerHref(row.manager_key)}>{row.manager}</a></span>}</td>
            <td className={`num ${positive ? 'up' : 'down'}`}><strong>{Number(row.value_delta) > 0 ? '+' : ''}{row.value_delta}</strong><span className="tsub block">{Number(row.production_score).toFixed(1)} return − {Number(row.draft_capital_score).toFixed(1)} expected</span></td>
            <td className="num"><strong>{row.fantasy_points}</strong><span className="tsub block">{sourceLabel(row.performance_source)}</span></td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

export function DraftRecordsSection({ records, full = false }: { records: DraftRecords; full?: boolean }) {
  const range = (years: number[]) => years.length ? `${years[0]}–${years.at(-1)}` : 'Awaiting complete coverage';
  const boardRange = range(records.coverage.board_seasons);
  const gradeRange = range(records.coverage.graded_seasons);
  const productiveYears = [...new Set(records.productiveMisses.map((row) => row.season))].sort((a, b) => a - b);
  const productiveRange = range(productiveYears);
  const firstRoundTotal = records.firstRoundPositions.reduce((sum, row) => sum + row.picks, 0);
  const positionTotal = records.positionSummary.reduce((sum, row) => sum + row.picks, 0);
  const firstPickTotal = records.positionSummary.reduce((sum, row) => sum + row.first_picks, 0);

  if (!full) {
    return (
      <>
        <h2>Draft history</h2>
        <a className="card" href="/history/drafts" style={{ display: 'block', textDecoration: 'none' }}>
          <span className="eyebrow">Draft ratings</span>
          <h3>Best classes, steals, busts and draft boards</h3>
          <p className="note">
            One combined draft room now holds the {boardRange} boards, {gradeRange} performance grades,
            franchise tendencies and links to every round-by-round ESPN draft.
          </p>
          <strong>Open draft history →</strong>
        </a>
      </>
    );
  }

  return (
    <>
      <div className="stat-strip">
        <div><strong>{boardRange}</strong><span>Draft boards on file</span></div>
        <div><strong>{gradeRange}</strong><span>Drafts with performance grades</span></div>
        <div><strong>{firstRoundTotal}</strong><span>First-round picks recorded</span></div>
        <div><strong>{records.firstRoundPositions[0] ? `${positionLabel(records.firstRoundPositions[0].default_position_id)} ${Math.round(records.firstRoundPositions[0].picks / Math.max(1, firstRoundTotal) * 100)}%` : '—'}</strong><span>Favorite first-round position</span></div>
      </div>

      <div className="callout" style={{ marginBottom: 18 }}>
        <strong>Draft value</strong> measures useful regular-season production above the historical return expected at that pick. Production above a replacement starter is scaled to the season&rsquo;s average league starter, then compared with similar picks in other seasons. A +20 grade means 20 normalized production points above expectation. The actual overall pick is used, including the board slots spent on kickers and defences. This is a hindsight grade; the season being graded never supplies its own benchmark.
      </div>

      <div className="callout" style={{ marginBottom: 18 }}>
        <strong>Coverage and sources.</strong> Every season uses the Grudge regular-season window, including player production while unrostered. ESPN weekly scores take priority; missing weeks and the older seasons are reconstructed from NFL statistics under that year&rsquo;s scoring rules. Reconstructed weeks omit the old long-touchdown bonus and are labeled estimates. Missing identity or scoring evidence blocks the entire season&rsquo;s grades. The complete 2007 board is graded after reviewed historical player-identity recovery. The 2005 and 2006 archives remain board-only because their recovered boards themselves are incomplete (119 of 128 and 129 of 160 pick rows respectively); those seasons stay withheld even where individual identities can be resolved. Model 2026.3 keeps each published result for comparison.
      </div>

      {records.coverage.blocked_seasons.length > 0 && <p className="note">
        Grades withheld for incomplete evidence: {records.coverage.blocked_seasons.join(', ')}.
      </p>}
      <h2>Draft class ratings</h2>
      <p className="sub">Average production above pick expectation across every QB, RB, WR and TE in a complete class. Kickers and defences are excluded from grades. Classes need at least eight offensive picks.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <ClassTable title={`Best draft classes · ${gradeRange}`} rows={records.bestClasses} />
        <ClassTable title={`Roughest draft classes · ${gradeRange}`} rows={records.worstClasses} />
      </div>

      <h2>Individual picks</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <PickTable title="Biggest steals" rows={records.steals} positive />
        <PickTable title="Biggest busts" rows={records.busts} positive={false} />
      </div>

      <h3>Biggest misses who stayed on the field</h3>
      <p className="sub">
        The five lowest-value picks in the available weekly-roster era who still scored in at least eight different weeks.
        The main bust list grades the outcome, including injuries; this companion list highlights players
        who had a sustained opportunity to produce. Its coverage expands automatically as completed seasons become gradable.
      </p>
      <div style={{ maxWidth: 720 }}>
        <PickTable title={`Available-season misses · ${productiveRange}`} rows={records.productiveMisses} positive={false} />
      </div>

      <h2>Draft habits</h2>
      <h3>Players franchises kept coming back to</h3>
      <p className="sub">Repeated-player counts use canonical player identities. Draft rows without a reviewed player crosswalk are not guessed into a career.</p>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Franchise</th><th>Player</th><th className="num">Times drafted</th><th>Seasons</th></tr></thead>
        <tbody>{records.repeats.map((row) => (
          <tr key={`${row.franchise_key}-${row.player_key}`}>
            <td><a href={franchiseHref(row.franchise_key)}>{row.team_name}</a></td>
            <td className="tname"><a href={playerHref(row.player_key)}>{row.full_name ?? row.player_key}</a></td>
            <td className="num"><strong>{row.times_drafted}</strong></td>
            <td>{row.seasons}</td>
          </tr>
        ))}</tbody>
      </table></div></div>

      <h3>Position history</h3>
      <p className="sub">
        All drafted positions with resolved season-aware player identity from the recovered boards. “First pick” means the first selection a franchise made in that season, rather than every pick that happened to fall in round 1.
      </p>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Position</th><th className="num">All picks</th><th className="num">Draft share</th><th className="num">First picks</th><th className="num">First-pick share</th></tr></thead>
        <tbody>{records.positionSummary.map((row) => (
          <tr key={row.default_position_id}>
            <td className="tname">{positionLabel(row.default_position_id)}</td>
            <td className="num">{row.picks}</td>
            <td className="num">{(row.picks / Math.max(1, positionTotal) * 100).toFixed(1)}%</td>
            <td className="num"><strong>{row.first_picks}</strong></td>
            <td className="num">{(row.first_picks / Math.max(1, firstPickTotal) * 100).toFixed(1)}%</td>
          </tr>
        ))}</tbody>
      </table></div></div>

      <h3>Franchise position report cards</h3>
      <p className="sub">
        Most drafted and first-pick tendencies use resolved player identities from the {boardRange} boards. Best and worst positions use the same positional value metric as the steal/bust tables, require at least eight graded picks at that position, and cover QB/RB/WR/TE from {gradeRange}.
      </p>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Franchise</th><th>Most drafted</th><th>Most common first pick</th><th>Best value position</th><th>Worst value position</th></tr></thead>
        <tbody>{records.franchisePositions.map((row) => {
          const bestValue = row.best_avg_value_delta == null ? null : Number(row.best_avg_value_delta);
          const worstValue = row.worst_avg_value_delta == null ? null : Number(row.worst_avg_value_delta);
          return (
            <tr key={row.franchise_key}>
              <td><a className="tname" href={franchiseHref(row.franchise_key)}>{row.team_name}</a></td>
              <td><strong>{positionLabel(row.most_drafted_position_id)}</strong><span className="tsub block">{row.most_drafted_picks ?? 0} of {row.total_picks} picks</span></td>
              <td><strong>{positionLabel(row.first_pick_position_id)}</strong><span className="tsub block">{row.first_pick_times ?? 0} of {row.drafts_on_file} drafts</span></td>
              <td className={bestValue == null ? undefined : bestValue > 0 ? 'up' : bestValue < 0 ? 'down' : undefined}><strong>{positionLabel(row.best_value_position_id)}{bestValue == null ? '' : ` ${signed(bestValue)}`}</strong><span className="tsub block">{row.best_graded_picks ?? 0} graded picks</span></td>
              <td className={worstValue == null ? undefined : worstValue > 0 ? 'up' : worstValue < 0 ? 'down' : undefined}><strong>{positionLabel(row.worst_value_position_id)}{worstValue == null ? '' : ` ${signed(worstValue)}`}</strong><span className="tsub block">{row.worst_graded_picks ?? 0} graded picks</span></td>
            </tr>
          );
        })}</tbody>
      </table></div></div>

      <p className="note">Want the receipts? Open any season&rsquo;s draft link above for the complete round-by-round ESPN board. Grades use ESPN data wherever the archive still has it; reconstructed point totals are labeled on individual steal/bust rows.</p>
    </>
  );
}
