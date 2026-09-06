import { franchiseHref } from '../lib/history-format.ts';
import type { DraftSlotRecords } from '../lib/draft-slot-records.ts';

const signed = (value: number | string) => {
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
};

const slotLabel = (slot: number) => `1.${String(slot).padStart(2, '0')}`;

export function DraftSlotSection({ records }: { records: DraftSlotRecords }) {
  const bestValueSlot = records.performance.reduce((best, row) => (
    !best || Number(row.avg_class_value) > Number(best.avg_class_value) ? row : best
  ), records.performance[0]);
  const worstValueSlot = records.performance.reduce((worst, row) => (
    !worst || Number(row.avg_class_value) < Number(worst.avg_class_value) ? row : worst
  ), records.performance[0]);
  const mostBestDraftsSlot = records.performance.reduce((best, row) => (
    !best || row.best_drafts > best.best_drafts ||
    (row.best_drafts === best.best_drafts && Number(row.avg_class_value) > Number(best.avg_class_value))
      ? row
      : best
  ), records.performance[0]);

  return (
    <>
      <h2>Draft slot history</h2>
      <p className="sub">
        This is draft order, not player position: 1.01 means the team that picked first overall,
        1.02 the team that picked second, and so on. Each team&rsquo;s full draft class is graded with
        the same position-adjusted value metric used above, then ranked against the other classes from that season.
      </p>

      {bestValueSlot && worstValueSlot && mostBestDraftsSlot && (
        <div className="stat-strip">
          <div><strong>{slotLabel(bestValueSlot.draft_slot)}</strong><span>Best average class value · {signed(bestValueSlot.avg_class_value)}</span></div>
          <div><strong>{slotLabel(mostBestDraftsSlot.draft_slot)}</strong><span>Most #1 draft classes · {mostBestDraftsSlot.best_drafts} of {mostBestDraftsSlot.graded_drafts}</span></div>
          <div><strong>{slotLabel(worstValueSlot.draft_slot)}</strong><span>Worst average class value · {signed(worstValueSlot.avg_class_value)}</span></div>
        </div>
      )}

      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Draft slot</th><th className="num">Avg value</th><th className="num">Avg class rank</th><th className="num">Best draft</th><th className="num">Top 3</th><th className="num">Worst draft</th></tr></thead>
        <tbody>{records.performance.map((row) => (
          <tr key={row.draft_slot}>
            <td><strong>{slotLabel(row.draft_slot)}</strong><span className="tsub block">#{row.draft_slot} overall</span></td>
            <td className={`num ${Number(row.avg_class_value) > 0 ? 'up' : Number(row.avg_class_value) < 0 ? 'down' : ''}`}><strong>{signed(row.avg_class_value)}</strong><span className="tsub block">positional slots / pick</span></td>
            <td className="num"><strong>{Number(row.avg_class_rank).toFixed(2)}</strong><span className="tsub block">1 = best class</span></td>
            <td className="num"><strong>{row.best_drafts}/{row.graded_drafts}</strong><span className="tsub block">{Number(row.best_draft_pct).toFixed(1)}%</span></td>
            <td className="num"><strong>{row.top3_drafts}/{row.graded_drafts}</strong><span className="tsub block">{Number(row.top3_pct).toFixed(1)}%</span></td>
            <td className="num"><strong>{row.worst_drafts}/{row.graded_drafts}</strong><span className="tsub block">{Number(row.worst_pct).toFixed(1)}%</span></td>
          </tr>
        ))}</tbody>
      </table></div></div>

      <p className="note">
        Draft-slot performance uses the 17 fully graded ten-team drafts from 2008–2025, excluding 2020.
        “Best draft” and “worst draft” mean the highest and lowest class value in that season; exact value ties count for each tied class.
      </p>

      <h3>Franchise draft-order history</h3>
      <p className="sub">
        Most common slot and 1.01 counts use every recovered first round from 2005–2025. The league had eight teams in 2005,
        and the 2006 archive is missing the row for overall pick #8, so a few franchises have 19 observed slots instead of 20.
      </p>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Franchise</th><th>Most common slot</th><th className="num">Times there</th><th className="num">1.01s</th><th className="num">Draft slots on file</th></tr></thead>
        <tbody>{records.franchises.map((row) => (
          <tr key={row.franchise_key}>
            <td><a className="tname" href={franchiseHref(row.franchise_key)}>{row.team_name}</a></td>
            <td><strong>{slotLabel(row.most_common_slot)}</strong><span className="tsub block">#{row.most_common_slot} overall</span></td>
            <td className="num"><strong>{row.most_common_slot_times}</strong></td>
            <td className="num"><strong>{row.first_overall_times}</strong></td>
            <td className="num">{row.drafts_on_file}</td>
          </tr>
        ))}</tbody>
      </table></div></div>
    </>
  );
}
