import { auth } from '@clerk/nextjs/server';
import { getCachedTradeRecords, getCachedSeasonTrades } from '../../lib/cached-queries.ts';
import { tradeSeasons, tradeVotes, votingOpen, type TradeCard, type VoteState } from '../../lib/trade-history-queries.ts';
import { POSITIONS } from '../../pipeline/trade.ts';
import { SeasonPicker } from '../../components/SeasonPicker.tsx';
import { TradeVote } from './TradeVote.tsx';

export const dynamic = 'force-dynamic';

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

function PlayerList({ players }: { players: TradeCard['received'][number] }) {
  if (!players.length) return <span className="note">No players recorded</span>;
  return (
    <ul className="trade-player-list">
      {players.map((p) => (
        <li key={p.espn_player_id}>
          <strong>{p.full_name ?? `ESPN player #${p.espn_player_id}`}</strong>
          <span className="tsub">{POSITIONS[p.default_position_id ?? 0] ?? '—'}</span>
        </li>
      ))}
    </ul>
  );
}

function SideGrade({ side, winner }: {
  side: TradeCard['value']['a']; winner: number | null;
}) {
  const won = winner === side.espn_team_id;
  return (
    <div className={`trade-grade ${won ? 'trade-winner' : ''}`}>
      <strong>{signed(side.lineupImpact)}</strong>
      <span>to their lineup</span>
      <span className="tsub">
        {side.valuedWeeks > 0 ? `${signed(side.playerValue)} over replacement` : '— over replacement'}
      </span>
      <span className="tsub">{side.startedPoints.toFixed(1)} actually started</span>
    </div>
  );
}

function TradeArticle({ card, vote, signedIn }: {
  card: TradeCard; vote?: VoteState; signedIn: boolean;
}) {
  const { trade, teamNames, received, value } = card;
  const teamA = teamNames[trade.team_a] ?? `Team ${trade.team_a}`;
  const teamB = teamNames[trade.team_b] ?? `Team ${trade.team_b}`;
  const open = votingOpen(trade);
  return (
    <article className="card trade-card">
      <div className="trade-meta">
        <span>{trade.season} · Week {trade.effective_week}</span>
        {trade.confidence === 'reciprocal' && <span className="tag era">Reconstructed</span>}
      </div>

      <div className="trade-sides">
        <section>
          <h3>{teamA} received</h3>
          <PlayerList players={received[trade.team_a] ?? []} />
          {value.graded && <SideGrade side={value.a} winner={value.winner} />}
        </section>
        <div className="trade-for">FOR</div>
        <section>
          <h3>{teamB} received</h3>
          <PlayerList players={received[trade.team_b] ?? []} />
          {value.graded && <SideGrade side={value.b} winner={value.winner} />}
        </section>
      </div>

      {!value.graded ? (
        <p className="note">Not enough completed scoring data to grade this trade yet.</p>
      ) : value.mutual ? (
        <p className="trade-verdict good-trade">Both teams improved their best lineups.</p>
      ) : value.winner === null ? (
        <p className="trade-verdict">Even by lineup impact.</p>
      ) : (
        <p className="trade-verdict">
          <strong>{teamNames[value.winner] ?? `Team ${value.winner}`}</strong> won by {Math.abs(value.margin).toFixed(1)} lineup points.
        </p>
      )}

      <TradeVote
        season={trade.season}
        tradeId={trade.trade_id}
        teamA={trade.team_a}
        teamB={trade.team_b}
        teamAName={teamA}
        teamBName={teamB}
        open={open}
        signedIn={signedIn}
        initialMine={vote?.mine ?? null}
        initialTally={vote?.tally ?? {}}
      />
    </article>
  );
}

export default async function TradesPage({ searchParams }: {
  searchParams: Promise<{ season?: string }>;
}) {
  const params = await searchParams;
  const seasons = await tradeSeasons();
  const current = seasons[0] ?? new Date().getFullYear();
  const requested = Number(params.season);
  const season = Number.isInteger(requested) && seasons.includes(requested) ? requested : current;

  const [cards, records, { userId }] = await Promise.all([
    getCachedSeasonTrades(season),
    getCachedTradeRecords(),
    auth(),
  ]);
  // Votes need a session and the member's identity; a signed-out visitor sees
  // the trades and the grades, just not the ballot.
  const votes: Record<string, VoteState> = userId ? await tradeVotes(season) : {};

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">Trade history</div>
        <h1>Trades</h1>
        <p>What each deal actually did to both teams&rsquo; best lineups.</p>
      </div>

      {cards.length === 0 ? (
        <div className="callout">
          No trades in {season} yet. Click below for the seasons that have them.
        </div>
      ) : (
        cards.map((card) => (
          <TradeArticle key={card.trade.trade_id} card={card}
                        vote={votes[card.trade.trade_id]} signedIn={Boolean(userId)} />
        ))
      )}

      {records.length > 0 && (
        <div className="card">
          <strong style={{ fontSize: 14 }}>All-time trade ledger</strong>
          <p className="note" style={{ marginTop: 6 }}>
            Lineup points gained minus lineup points handed to the other side,
            every trade, every season. Ranked on points rather than wins and
            losses, because two lopsided trades and two coin flips are not the
            same record.
          </p>
          <div className="scroll" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Manager</th><th>Trades</th><th>W–L</th>
                  <th>Gained</th><th>Given</th><th>Net</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.franchiseKey}>
                    <td>{r.name}</td>
                    <td>{r.trades}</td>
                    <td>{r.won}–{r.lost}{r.even ? `–${r.even}` : ''}</td>
                    <td>{r.gained.toFixed(1)}</td>
                    <td>{r.given.toFixed(1)}</td>
                    <td className={r.net > 0 ? 'up' : r.net < 0 ? 'down' : ''}>
                      {signed(r.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <details>
          <summary>How a trade is scored</summary>
          <div className="note trade-explainer">
            <p>
              Not by adding up points &mdash; by what it did to your lineup. Each
              week after the trade we take your real roster, work out the best
              lineup it could have fielded, then do the same for the roster you
              would have had without the trade. The gap is what the trade was
              worth that week.
            </p>

            <p><strong>Example: week 10, 2024.</strong> Austin Bubbs sent Kareem
              Hunt to the Penguins for Chris Olave. Olave scored 0.0 in all eight
              remaining weeks &mdash; he never played again. Hunt scored 63.9.</p>
            <ul>
              <li>
                <strong>Bubbs, &minus;17.4 to their lineup.</strong> Keeping Hunt
                would have added 17.4 points to his best lineups. Not 63.9,
                because Bubbs had other backs: Hunt only counts in the weeks he
                would actually have started, and only by the margin.
              </li>
              <li>
                <strong>Penguins, +31.1 to their lineup and &minus;1.6 over
                replacement.</strong> Both true. Hunt was a mediocre starting back
                in absolute terms, but better than what they had on the bench.
              </li>
            </ul>

            <p><strong>So the two numbers ask different questions.</strong>{' '}
              <em>To their lineup</em> &mdash; did this put points on my field,
              measured against the team I actually had. <em>Over replacement</em>
              &mdash; was the player any good, measured against a freely available
              body at his position. A dash means he never reached the lineup, so
              there was nothing to measure.</p>

            <p><strong>Voting</strong> opens on the Tuesday after the week a trade
              takes effect and runs for seven days. A deal made between the draft
              and week 1 opens when week 1 finishes and closes when week 2 does;
              one made during week 1 opens a week after that. This season only.
              Your pick stays private until you make it, then you see the
              league&rsquo;s.</p>

            <p><strong>Also:</strong> the best lineup is used, not the one you set,
              so this scores the trade and not your Sunday morning &mdash; what you
              actually started is shown alongside. A player counts only while the
              team that got him keeps him. Both sides can gain, and that is what a
              good trade looks like. Kickers and defences are listed but not
              counted.</p>

            <p><strong>Where these came from.</strong> For the recovered 2018–2025
              history, completed ESPN transaction envelopes are the source of
              truth whenever they preserve the players sent in both directions.
              Some old accepted trades survive only as an empty transaction shell;
              those are marked <span className="tag era">Reconstructed</span> and
              are included only when consecutive weekly rosters show players
              moving both directions between the same two teams. A one-way roster
              change is never called a trade. That conservative rule matters when
              somebody is traded twice between weekly snapshots: the exact ESPN
              ledger wins instead of turning the two real deals into one fictional
              net move.</p>
          </div>
        </details>
      </div>

      <SeasonPicker seasons={seasons} current={season} basePath="/trades"
                    heading="Seasons with trades"
                    note="2018 is as far back as the player-level weekly roster archive goes." />
    </>
  );
}
