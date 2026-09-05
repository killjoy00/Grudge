import {
  getVaultBiggestBlowout,
  getVaultClosestFinish,
  getVaultHighestScore,
  getVaultSeasons,
  type VaultMomentRow,
} from '../../../lib/vault-queries.ts';

export const dynamic = 'force-dynamic';

function moment(row: VaultMomentRow | null) {
  if (!row) return <span>—</span>;
  return (
    <>
      <strong>{row.winner_name} {row.winner_points}–{row.loser_points} {row.loser_name}</strong>
      <span className="block note"><a href={`/history/vault/${row.season}`}>{row.season} · Week {row.week}</a></span>
    </>
  );
}

export default async function HistoryVaultPage() {
  const [seasons, highest, blowout, closest] = await Promise.all([
    getVaultSeasons(),
    getVaultHighestScore(),
    getVaultBiggestBlowout(),
    getVaultClosestFinish(),
  ]);
  const seasonsWithGames = seasons.filter((row) => row.decided_games > 0);
  const first = seasonsWithGames.at(-1)?.season ?? null;
  const last = seasonsWithGames[0]?.season ?? null;
  const totalGames = seasonsWithGames.reduce((sum, row) => sum + row.decided_games, 0);
  const totalDraftPicks = seasons.reduce((sum, row) => sum + row.draft_picks, 0);

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">Recovered from ESPN</div>
        <h1>The Vault</h1>
        <p>Every scoreboard we can recover. Every draft board ESPN still remembers. Twenty years of receipts.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 24px' }}>
        <a className="btn btn-quiet" href="/history">← League history</a>
        <a className="btn btn-quiet" href="/history/rivalries">All-time rivalries</a>
        <a className="btn btn-quiet" href="/history/records">Record book</a>
      </div>

      <div className="stat-strip three">
        <div><strong>{first && last ? `${first}–${last}` : '—'}</strong><span>Weekly scoreboards</span></div>
        <div><strong>{totalGames.toLocaleString()}</strong><span>Decided games recovered</span></div>
        <div><strong>{totalDraftPicks.toLocaleString()}</strong><span>Draft picks on file</span></div>
      </div>

      <h2>From the archives</h2>
      <div className="card">
        <div style={{ display: 'grid', gap: 18 }}>
          <div><span className="eyebrow">Highest winning score</span>{moment(highest)}</div>
          <div><span className="eyebrow">Biggest blowout</span>{moment(blowout)}{blowout && <span className="block note">Margin: {blowout.margin}</span>}</div>
          <div><span className="eyebrow">Closest finish</span>{moment(closest)}{closest && <span className="block note">Margin: {closest.margin}</span>}</div>
        </div>
      </div>

      <h2>Season files</h2>
      <p className="sub">Open a year for the week-by-week scoreboard, complete draft board, and any non-draft transactions ESPN still exposes.</p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Season</th><th className="num">Teams</th><th className="num">Games</th><th className="num">Draft picks</th><th className="num">Transactions</th><th>Ledger</th></tr>
            </thead>
            <tbody>
              {seasons.map((row) => (
                <tr key={row.season}>
                  <td><a className="tname" href={`/history/vault/${row.season}`}>{row.season}</a>{row.season === 2020 && <span className="tsub block">league did not play</span>}</td>
                  <td className="num">{row.team_count || '—'}</td>
                  <td className="num">{row.decided_games || '—'}{row.games > row.decided_games && <span className="tsub block">{row.games} scheduled</span>}</td>
                  <td className="num">{row.draft_picks || '—'}</td>
                  <td className="num">{row.transactions || '—'}</td>
                  <td>{row.transaction_types ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="callout" style={{ marginTop: 24 }}>
        ESPN preserves team-level weekly scores back to 2005. Its pre-2018 player-level boxscores no longer include the old lineup entries, so legacy scoreboards are complete at the team level but do not support bench-loss or individual-week reconstruction.
      </div>
    </>
  );
}
