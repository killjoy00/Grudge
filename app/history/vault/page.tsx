import { HistoryNav } from '../../../components/HistoryNav.tsx';
import { getVaultCoverage } from '../../../lib/vault-coverage.ts';

export const dynamic = 'force-dynamic';

function coverage(value: number, missingLabel = 'Unavailable') {
  return value > 0 ? <span className="tag best">On file</span> : <span className="tsub">{missingLabel}</span>;
}

export default async function HistoryVaultPage() {
  const seasons = await getVaultCoverage();
  const seasonsWithGames = seasons.filter((row) => row.decided_games > 0);
  const first = seasonsWithGames.at(-1)?.season ?? null;
  const last = seasonsWithGames[0]?.season ?? null;
  const totalGames = seasonsWithGames.reduce((sum, row) => sum + row.decided_games, 0);
  const totalDraftPicks = seasons.reduce((sum, row) => sum + row.draft_picks, 0);
  const totalTransactions = seasons.reduce((sum, row) => sum + row.transactions, 0);

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The Vault</div>
        <h1>Data coverage & source material</h1>
        <p>A reference for what ESPN actually preserved, season by season. This supports the history pages; it is not a separate record book.</p>
      </div>

      <HistoryNav current="vault" />

      <div className="stat-strip">
        <div><strong>{first && last ? `${first}–${last}` : '—'}</strong><span>Weekly scoreboards</span></div>
        <div><strong>{totalGames.toLocaleString()}</strong><span>Decided games</span></div>
        <div><strong>{totalDraftPicks.toLocaleString()}</strong><span>Draft picks loaded</span></div>
        <div><strong>{totalTransactions.toLocaleString()}</strong><span>Transaction rows loaded</span></div>
      </div>

      <h2>What survives by era</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <div className="card">
          <span className="eyebrow">2005–2017</span>
          <h3>Scores + drafts</h3>
          <p className="note">Complete team-level weekly scoreboards and draft recaps. ESPN&rsquo;s old API returns no transaction ledger and no player-level weekly lineup entries. Those two absences were tested across every scoring period.</p>
        </div>
        <div className="card">
          <span className="eyebrow">2018–2025</span>
          <h3>Full weekly detail + drafts</h3>
          <p className="note">Player-level boxscores, transaction history and draft boards are all on file. The draft boards were recovered separately because the original historical capture had omitted ESPN&rsquo;s <code>mDraftDetail</code> view.</p>
        </div>
        <div className="card">
          <span className="eyebrow">2026 onward</span>
          <h3>Captured live</h3>
          <p className="note">Draft, transactions, player lineups, weekly scores, projections and derived features are captured as part of the active pipeline.</p>
        </div>
      </div>

      <h2>Season evidence matrix</h2>
      <p className="sub">Open a year for its source scoreboard, draft board and transaction archaeology. “Gap” means a recoverable source has not been captured; “Unavailable” means ESPN no longer returns it.</p>
      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Season</th><th className="num">Teams</th><th className="num">Games</th><th>Weekly scores</th><th>Draft</th><th>Transactions</th><th>Player lineups</th><th>Power model</th></tr>
            </thead>
            <tbody>
              {seasons.map((row) => {
                const didNotPlay = row.season === 2020;
                const draftGap = row.season >= 2018 && row.season <= 2025 && row.draft_picks === 0;
                const legacy = row.season < 2018;
                return (
                  <tr key={row.season}>
                    <td>
                      {didNotPlay ? <strong>{row.season}</strong> : <a className="tname" href={`/history/vault/${row.season}`}>{row.season}</a>}
                      {didNotPlay && <span className="tsub block">league did not play</span>}
                    </td>
                    <td className="num">{row.teams || '—'}</td>
                    <td className="num">{row.decided_games || '—'}</td>
                    <td>{didNotPlay ? '—' : coverage(row.decided_games)}</td>
                    <td>
                      {didNotPlay ? '—' : draftGap
                        ? <span className="tag era">Recoverable gap</span>
                        : coverage(row.draft_picks, 'Not captured')}
                    </td>
                    <td>{didNotPlay ? '—' : legacy ? <span className="tsub">Unavailable</span> : coverage(row.transactions, 'None yet')}</td>
                    <td>{didNotPlay ? '—' : legacy ? <span className="tsub">Unavailable</span> : coverage(row.roster_entries, 'None yet')}</td>
                    <td>{didNotPlay ? '—' : coverage(row.power_rows, 'Pending')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="callout" style={{ marginTop: 24 }}>
        <strong>Authority rule:</strong> for 2005–2017, the commissioner archive remains authoritative for final standings, playoff finish and championships. ESPN&rsquo;s recovered weekly scoreboards and draft boards enrich that record; they do not overwrite it.
      </div>
    </>
  );
}
