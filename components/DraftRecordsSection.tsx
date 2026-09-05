import { franchiseHref, managerHref } from '../lib/history-format.ts';
import type { DraftClassRow, DraftPickValueRow, DraftRecords } from '../lib/draft-records.ts';
import { POSITIONS } from '../pipeline/trade.ts';

const signed = (value: number | string) => {
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
};

function ClassTable({ title, rows }: { title: string; rows: DraftClassRow[] }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="scroll"><table>
        <thead><tr><th>#</th><th>Draft</th><th>Manager</th><th className="num">Value</th><th className="num">Picks</th></tr></thead>
        <tbody>{rows.slice(0, 5).map((row, index) => (
          <tr key={`${title}-${row.season}-${row.franchise_key}`}>
            <td>{index + 1}</td>
            <td>
              <a className="tname" href={`/history/vault/${row.season}#draft`}>{row.season} {row.team_name}</a>
              <span className="tsub block">{row.fantasy_points} rostered fantasy points</span>
            </td>
            <td>{row.manager_key && row.manager ? <a href={managerHref(row.manager_key)}>{row.manager}</a> : '—'}</td>
            <td className="num"><strong>{signed(row.avg_value_delta)}</strong><span className="tsub block">avg positional slots</span></td>
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
        <tbody>{rows.slice(0, 5).map((row, index) => (
          <tr key={`${title}-${row.season}-${row.overall_pick}`}>
            <td>{index + 1}</td>
            <td>
              <span className="tname">{row.full_name ?? `ESPN player #${row.espn_player_id}`}</span>
              <span className="tsub block">{POSITIONS[row.default_position_id ?? 0] ?? '—'} · {row.season} R{row.round} P{row.round_pick} (#{row.overall_pick})</span>
            </td>
            <td><a href={franchiseHref(row.franchise_key)}>{row.team_name}</a>{row.manager_key && row.manager && <span className="tsub block"><a href={managerHref(row.manager_key)}>{row.manager}</a></span>}</td>
            <td className={`num ${positive ? 'up' : 'down'}`}><strong>{row.value_delta > 0 ? '+' : ''}{row.value_delta}</strong><span className="tsub block">positional slots</span></td>
            <td className="num">{row.fantasy_points}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

export function DraftRecordsSection({ records }: { records: DraftRecords }) {
  const firstRoundTotal = records.firstRoundPositions.reduce((sum, row) => sum + row.picks, 0);
  const topRepeat = records.repeats[0];

  return (
    <>
      <h2>Draft history</h2>
      <p className="sub">
        Every draft board survives back to 2005. Performance grades start in 2018, when ESPN begins preserving player-level weekly scoring. Kickers and defenses are excluded from grading.
      </p>

      <div className="stat-strip">
        <div><strong>2005–2025</strong><span>Draft boards on file</span></div>
        <div><strong>{firstRoundTotal}</strong><span>First-round picks recorded</span></div>
        <div><strong>{records.firstRoundPositions[0] ? `${POSITIONS[records.firstRoundPositions[0].default_position_id ?? 0] ?? '—'} ${Math.round(records.firstRoundPositions[0].picks / Math.max(1, firstRoundTotal) * 100)}%` : '—'}</strong><span>Favorite first-round position</span></div>
        <div><strong>{topRepeat ? `${topRepeat.full_name} ×${topRepeat.times_drafted}` : '—'}</strong><span>Most loyal franchise-player pairing</span></div>
      </div>

      <div className="callout" style={{ marginBottom: 18 }}>
        <strong>Draft value</strong> is position-adjusted hindsight, not raw fantasy points: within each season and position, we compare where a player was drafted with where his preserved season production ranked. A +10 means he finished ten positional slots better than his draft capital implied; −10 means ten worse. This lets QBs, RBs, WRs and TEs share one scale without pretending their raw point totals are equivalent.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <ClassTable title="Best draft classes · 2018–2025" rows={records.bestClasses} />
        <ClassTable title="Roughest draft classes · 2018–2025" rows={records.worstClasses} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginTop: 14 }}>
        <PickTable title="Biggest steals" rows={records.steals} positive />
        <PickTable title="Biggest busts" rows={records.busts} positive={false} />
      </div>

      <h3>Players franchises kept coming back to</h3>
      <p className="sub">This one uses the full 2005–2025 draft archive and needs no player-performance assumptions.</p>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Franchise</th><th>Player</th><th className="num">Times drafted</th><th>Seasons</th></tr></thead>
        <tbody>{records.repeats.map((row) => (
          <tr key={`${row.franchise_key}-${row.espn_player_id}`}>
            <td><a href={franchiseHref(row.franchise_key)}>{row.team_name}</a></td>
            <td className="tname">{row.full_name ?? `ESPN player #${row.espn_player_id}`}</td>
            <td className="num"><strong>{row.times_drafted}</strong></td>
            <td>{row.seasons}</td>
          </tr>
        ))}</tbody>
      </table></div></div>

      <p className="note">
        Want the receipts? Open any season&rsquo;s draft link above for the complete round-by-round ESPN board. Pre-2018 boards are fully browsable but intentionally not given performance grades because ESPN no longer returns those players&rsquo; weekly scoring history.
      </p>
    </>
  );
}
