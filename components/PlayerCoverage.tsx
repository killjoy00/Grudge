import type { PlayerImport } from '../lib/player-data.ts';

export function PlayerCoverage({ coverage }: {coverage: PlayerImport | undefined}) {
  const rate = (stat: number, position = 1) => {
    const item = coverage?.scoring_items?.find(i => i.statId === stat);
    return item?.pointsOverrides?.[String(position)] ?? item?.points ?? 0;
  };
  const passing = [[3, 1], [5, 5], [8, 25], [10, 100]].filter(([id]) => rate(id!))
    .map(([id, yards]) => `${rate(id!)} per ${yards === 1 ? 'yard' : `whole ${yards}-yard block`}`).join(' + ');
  return <details className="card player-methodology">
    <summary>How points and history are counted</summary>
    {coverage?.scoring_items && <><h3>{coverage.season} Grudge scoring</h3><div className="scroll"><table>
      <tbody>
        <tr><th>Passing</th><td>{passing} · TD {rate(4)} · INT {rate(20)}</td></tr>
        <tr><th>Rushing</th><td>{rate(24) ? `${rate(24)} per yard` : `${rate(28)} per whole 10-yard block`} · TD {rate(25)}</td></tr>
        <tr><th>Receiving</th><td>{rate(42, 3) ? `${rate(42, 3)} per yard` : `${rate(48, 3)} per whole 10-yard block`} · TD {rate(43, 3)}</td></tr>
        <tr><th>Receptions</th><td>RB {rate(53, 2)} · WR {rate(53, 3)} · TE {rate(53, 4)}</td></tr>
        <tr><th>Other offense</th><td>40+ yard TD bonus: pass {rate(15)}, rush {rate(35)}, catch {rate(45, 3)} · Fumble lost {rate(72)}</td></tr>
        <tr><th>Kicking</th><td>FG under 40: {rate(80)} · 40–49: {rate(77)} · 50–59: {rate(198) || rate(74)} · 60+: {rate(201) || rate(74)} · XP {rate(86)}</td></tr>
        <tr><th>D/ST plays</th><td>Sack {rate(99,16)} · INT {rate(95,16)} · Recovery {rate(96,16)} · Safety {rate(98,16)} · TD {rate(103,16)}</td></tr>
      </tbody></table></div></>}
    <p>Fantasy points use Grudge&rsquo;s archived rules for each season, starting in 2005. Recorded ESPN weekly scores take priority.
      Rebuilt scores use NFL stats and play-by-play, including long-touchdown bonuses. Rebuilt totals may differ after provider corrections.</p>
    <p>The NFL regular season includes every NFL week, even after the Grudge season ends. NFL playoffs are a separate filter.
      Games* counts games with a stat record, so an inactive player, bye or missing record is never turned into a zero-point appearance.
      A dash means unavailable; a recorded zero is shown as 0.00. A total with missing scoring evidence is withheld.</p>
    <p>Grudge history combines drafts, completed adds and drops, the existing trade ledger, and roster snapshots.
      Trades marked reconstructed come from changes between rosters. Before 2018, surviving drafts and final rosters cannot establish
      every owner or the date and cause of a move. The league did not play in 2020; that year&rsquo;s fantasy points apply its archived rules to NFL games.</p>
    {coverage && <p className="note">{coverage.season} data published {new Date(coverage.published_at).toISOString().slice(0, 10)} · {coverage.row_count.toLocaleString('en-US')} player-game records · {coverage.model_version}.</p>}
    <p className="note">NFL statistics: <a href="https://github.com/nflverse/nflverse-data">nflverse</a>. League scores and history: archived ESPN league data.</p>
  </details>;
}
