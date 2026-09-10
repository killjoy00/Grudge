import { franchiseHref } from '../lib/history-format.ts';
import type { DraftSlotRecords } from '../lib/draft-slot-records.ts';

const signed = (value: number | string) => {
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
};

const slotLabel = (slot: number) => `1.${String(slot).padStart(2, '0')}`;
const span = (rows: Array<{ first_season: number; last_season: number }>) => rows.length
  ? `${Math.min(...rows.map((row) => row.first_season))}–${Math.max(...rows.map((row) => row.last_season))}`
  : '—';

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
  const outcomesBySlot = new Map(records.outcomes.map((row) => [row.draft_slot, row]));
  const performanceRange = span(records.performance);
  const outcomeRange = span(records.outcomes);
  const draftRange = span(records.franchises);

  return (
    <>
      <h2>Draft slot history</h2>
      <p className="sub">
        This is draft order, not player position: 1.01 means the team that picked first overall,
        1.02 the team that picked second, and so on. Each team&rsquo;s full draft class is graded with
        the current production-above-replacement minus historical pick-expectation model, then ranked against the other classes from that season.
      </p>

      {bestValueSlot && worstValueSlot && mostBestDraftsSlot && (
        <div className="stat-strip">
          <div><strong>{slotLabel(bestValueSlot.draft_slot)}</strong><span>Best average class value · {signed(bestValueSlot.avg_class_value)}</span></div>
          <div><strong>{slotLabel(mostBestDraftsSlot.draft_slot)}</strong><span>Most #1 draft classes · {mostBestDraftsSlot.best_drafts} of {mostBestDraftsSlot.graded_drafts}</span></div>
          <div><strong>{slotLabel(worstValueSlot.draft_slot)}</strong><span>Worst average class value · {signed(worstValueSlot.avg_class_value)}</span></div>
        </div>
      )}

      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Draft slot</th><th className="num">Avg value</th><th className="num">Avg class rank</th><th className="num">Best draft</th><th className="num">Top 3</th><th className="num">Worst draft</th><th className="num">Reg. Champ.</th><th className="num">Champ</th></tr></thead>
        <tbody>{records.performance.map((row) => {
          const outcome = outcomesBySlot.get(row.draft_slot);
          return (
            <tr key={row.draft_slot}>
              <td><strong>{slotLabel(row.draft_slot)}</strong><span className="tsub block">#{row.draft_slot} overall</span></td>
              <td className={`num ${Number(row.avg_class_value) > 0 ? 'up' : Number(row.avg_class_value) < 0 ? 'down' : ''}`}><strong>{signed(row.avg_class_value)}</strong><span className="tsub block">value points / graded pick</span></td>
              <td className="num"><strong>{Number(row.avg_class_rank).toFixed(2)}</strong><span className="tsub block">1 = best class</span></td>
              <td className="num"><strong>{row.best_drafts}/{row.graded_drafts}</strong><span className="tsub block">{Number(row.best_draft_pct).toFixed(1)}%</span></td>
              <td className="num"><strong>{row.top3_drafts}/{row.graded_drafts}</strong><span className="tsub block">{Number(row.top3_pct).toFixed(1)}%</span></td>
              <td className="num"><strong>{row.worst_drafts}/{row.graded_drafts}</strong><span className="tsub block">{Number(row.worst_pct).toFixed(1)}%</span></td>
              <td className="num"><strong>{outcome ? `${outcome.regular_season_firsts}/${outcome.seasons_on_file}` : '—'}</strong>{outcome && <span className="tsub block">{Number(outcome.regular_season_first_pct).toFixed(1)}%</span>}</td>
              <td className="num"><strong>{outcome ? `${outcome.championships}/${outcome.seasons_on_file}` : '—'}</strong>{outcome && <span className="tsub block">{Number(outcome.championship_pct).toFixed(1)}%</span>}</td>
            </tr>
          );
        })}</tbody>
      </table></div></div>

      <p className="note">
        Draft-quality columns use complete, published ten-team drafts from {performanceRange}, excluding 2020, and read the currently published draft-model results.
        “Best draft” and “worst draft” mean the highest and lowest class value in that season; exact value ties count for each tied class.
        Reg. Champ. and Champ use settled season outcomes from {outcomeRange}, excluding 2020. A live draft is not added to those denominators until its season result exists.
      </p>

      <h3>Franchise draft-order history</h3>
      <p className="sub">
        Most common slot and 1.01 counts use every recovered first round from {draftRange}. This can include the current season&rsquo;s draft as soon as the board is captured.
        The league had eight teams in 2005. The 2006 archive is incomplete and is missing the 1.08 row; draft-order history keeps the first-round slots that are actually observed, while performance grading refuses that incomplete board.
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
