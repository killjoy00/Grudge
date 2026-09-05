import { notFound } from 'next/navigation';

import { HistoryNav } from '../../../../components/HistoryNav.tsx';
import { POSITIONS } from '../../../../pipeline/trade.ts';
import {
  getVaultSeasonDraft,
  getVaultSeasonGames,
  getVaultSeasonTransactions,
  getVaultSeasons,
} from '../../../../lib/vault-queries.ts';

export const dynamic = 'force-dynamic';

function score(value: string | null) {
  return value ?? '—';
}

export default async function VaultSeasonPage({ params }: { params: Promise<{ season: string }> }) {
  const raw = await params;
  const season = Number(raw.season);
  if (!Number.isInteger(season) || season < 2005) notFound();

  const [games, draft, transactions, seasonList] = await Promise.all([
    getVaultSeasonGames(season),
    getVaultSeasonDraft(season),
    getVaultSeasonTransactions(season),
    getVaultSeasons(),
  ]);
  if (games.length === 0 && draft.length === 0 && transactions.length === 0) notFound();

  const weeks = [...new Set(games.map((game) => game.week))].sort((a, b) => a - b);
  const rounds = [...new Set(draft.map((pick) => pick.round))].sort((a, b) => a - b);
  const nonDraftTransactions = transactions.length;
  const seasonIndex = seasonList.findIndex((row) => row.season === season);
  const newer = seasonIndex > 0 ? seasonList[seasonIndex - 1]?.season : null;
  const older = seasonIndex >= 0 && seasonIndex < seasonList.length - 1 ? seasonList[seasonIndex + 1]?.season : null;
  const summary = seasonList.find((row) => row.season === season) ?? null;

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The Vault · season evidence</div>
        <h1>{season}</h1>
        <p>{games.filter((game) => game.is_final).length} decided games · {draft.length} draft picks · {nonDraftTransactions} recovered non-draft transactions.</p>
      </div>

      <HistoryNav current="vault" />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 24px' }}>
        {older && <a className="btn btn-quiet" href={`/history/vault/${older}`}>← {older}</a>}
        <a className="btn btn-quiet" href={`/history/${season}`}>Season file</a>
        <a className="btn btn-quiet" href={`/rankings?season=${season}`}>Power rankings</a>
        {newer && <a className="btn btn-quiet" href={`/history/vault/${newer}`}>{newer} →</a>}
      </div>

      <div className="stat-strip three">
        <div><strong>{summary?.team_count ?? '—'}</strong><span>Teams</span></div>
        <div><strong>{summary?.decided_games ?? games.filter((game) => game.is_final).length}</strong><span>Decided games</span></div>
        <div><strong>{draft.length}</strong><span>Draft picks</span></div>
      </div>

      <h2>Week-by-week scoreboard</h2>
      <p className="sub">ESPN&rsquo;s own matchup ledger. Winner is bolded; playoff labels are shown where the old payload still identifies them.</p>
      {weeks.map((week) => {
        const weekGames = games.filter((game) => game.week === week);
        const isPlayoff = weekGames.some((game) => game.playoff_tier && game.playoff_tier !== 'NONE');
        return (
          <div key={week} style={{ marginBottom: 22 }}>
            <h3>Week {week}{isPlayoff ? ' · Playoffs' : ''}</h3>
            <div className="card">
              <div className="scroll">
                <table>
                  <thead><tr><th>Matchup</th><th className="num">Score</th></tr></thead>
                  <tbody>
                    {weekGames.map((game) => {
                      const homeWon = game.winner === 'HOME';
                      const awayWon = game.winner === 'AWAY';
                      return (
                        <tr key={game.espn_matchup_id}>
                          <td>
                            <span className={homeWon ? 'tname' : undefined}>{homeWon ? <strong>{game.home_name}</strong> : game.home_name}</span>
                            <span className="tsub block">vs. {awayWon ? <strong>{game.away_name}</strong> : game.away_name}</span>
                            {game.playoff_tier && <span className="tag era">{game.playoff_tier.replaceAll('_', ' ').toLowerCase()}</span>}
                          </td>
                          <td className="num">
                            <span className="block">{homeWon ? <strong>{score(game.home_points)}</strong> : score(game.home_points)}</span>
                            <span className="block">{awayWon ? <strong>{score(game.away_points)}</strong> : score(game.away_points)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}

      <h2>Draft Time Machine</h2>
      {draft.length === 0 ? (
        <div className="callout">
          {season >= 2018 && season <= 2025
            ? 'This board is a recoverable archive gap: the original historical capture did not request ESPN draft detail.'
            : 'No draft board is available for this season.'}
        </div>
      ) : (
        <>
          <p className="sub">The ESPN draft recap, round by round. Unknown names are retained by ESPN player ID rather than discarded.</p>
          {rounds.map((round) => (
            <div key={round} style={{ marginBottom: 22 }}>
              <h3>Round {round}</h3>
              <div className="card">
                <div className="scroll">
                  <table>
                    <thead><tr><th className="rank">Pick</th><th>Player</th><th>Drafted by</th></tr></thead>
                    <tbody>
                      {draft.filter((pick) => pick.round === round).map((pick) => (
                        <tr key={pick.overall_pick}>
                          <td className="rank">{pick.round}.{String(pick.round_pick).padStart(2, '0')}<span className="tsub block">#{pick.overall_pick} overall</span></td>
                          <td>
                            <span className="tname">{pick.player_name ?? `ESPN player #${pick.espn_player_id}`}</span>
                            <span className="tsub block">{POSITIONS[pick.position_id ?? 0] ?? 'Position unavailable'}</span>
                            {pick.is_keeper && <span className="tag best">keeper</span>}
                          </td>
                          <td>{pick.team_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <h2>Transaction archaeology</h2>
      {transactions.length === 0 ? (
        <div className="callout">
          {season < 2018
            ? 'ESPN no longer returns a non-draft transaction ledger for this era. Every scoring period was checked; this is a source limitation, not a missing import.'
            : 'No non-draft transactions are loaded for this season.'}
        </div>
      ) : (
        <div className="card">
          <div className="scroll">
            <table>
              <thead><tr><th>Week</th><th>Type</th><th>Team</th><th>Players</th><th className="num">FAAB</th></tr></thead>
              <tbody>
                {transactions.map((row) => (
                  <tr key={row.espn_transaction_id}>
                    <td>{row.week}</td>
                    <td><strong>{row.type}</strong><span className="tsub block">{row.status}</span></td>
                    <td>{row.team_name ?? 'League / multi-team'}</td>
                    <td>{row.players ?? (row.item_count ? `${row.item_count} item${row.item_count === 1 ? '' : 's'}` : '—')}</td>
                    <td className="num">{Number(row.bid_amount) > 0 ? `$${Number(row.bid_amount).toFixed(0)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {season < 2018 && (
        <p className="note" style={{ marginTop: 24 }}>
          Legacy limitation: ESPN still serves the team-level scoreboard and draft board, but its old per-player weekly boxscore entries are empty. Individual weekly performances and points left on the bench therefore remain unavailable before 2018.
        </p>
      )}
    </>
  );
}
