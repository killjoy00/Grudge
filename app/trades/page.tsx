import { auth } from '@clerk/nextjs/server';
import { tradeSeasons, tradeVotes, votingOpen, type TradeCard, type VoteState }
  from '../../lib/trade-history-queries.ts';
import { getCachedSeasonTrades, getCachedTradeRecords } from '../../lib/cached-queries.ts';
import { UNGRADED_POSITIONS, type SideValue } from '../../pipeline/trade-value.ts';
import { getCurrentSeason } from '../../lib/queries.ts';
import { SeasonPicker } from '../../components/SeasonPicker.tsx';
import { EspnTeamLink } from '../../components/EspnLink.tsx';
import { TradeVote } from '../../components/TradeVote.tsx';
import { POSITIONS } from '../../pipeline/trade.ts';

export const dynamic = 'force-dynamic';

const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

function TradeSide({
  card, teamId, accent, side, ahead,
}: {
  card: TradeCard; teamId: number; accent: string;
  side: SideValue;
  ahead: boolean;
}) {
  const players = card.received[teamId] ?? [];
  return (
    <div className={`trade-side${ahead ? ' ahead' : ''}`} style={{ borderTopColor: accent }}>
      <div className="trade-side-head">
        <a href={`/team/${teamId}`} className="tname">{card.teamNames[teamId] ?? `Team ${teamId}`}</a>
        <EspnTeamLink teamId={teamId} season={card.trade.season} />
      </div>
      <div className="trade-got">got</div>
      <ul className="trade-players">
        {players.length === 0 && <li className="note">nothing this side of the ledger</li>}
        {players.map((p) => {
          const counted = !UNGRADED_POSITIONS.has(p.default_position_id ?? -1);
          return (
            <li key={p.espn_player_id} className={counted ? undefined : 'trade-uncounted'}>
              <span className="trade-pos">
                {POSITIONS[p.default_position_id ?? 0] ?? '\u2014'}
              </span>
              {p.full_name ?? `Player ${p.espn_player_id}`}
              {!counted && <span className="trade-nocount"> not counted</span>}
            </li>
          );
        })}
      </ul>
      <div className="trade-points">
        <span className={`trade-impact ${side.lineupImpact > 0 ? 'up' : side.lineupImpact < 0 ? 'down' : ''}`}>
          {signed(side.lineupImpact)}
        </span>
        <span className="trade-impact-label">to their lineup</span>
        <div className="note trade-secondary">
          {/* A dash, not 0.0, when nothing was measured. An acquisition who
              never made the lineup contributed nothing, which is a different
              statement from one who scored exactly replacement level. */}
          <span title={side.valuedWeeks === 0
            ? 'Never in the best lineup, so there is nothing to measure against replacement.'
            : `Measured over ${side.valuedWeeks} week${side.valuedWeeks === 1 ? '' : 's'} in the best lineup.`}>
            {side.valuedWeeks === 0 ? '—' : signed(side.playerValue)} over replacement
          </span>{' · '}
          {side.startedPoints.toFixed(1)} of {side.rosteredPoints.toFixed(1)} started
        </div>
      </div>
    </div>
  );
}

function TradeArticle({
  card, vote, signedIn,
}: { card: TradeCard; vote: VoteState | undefined; signedIn: boolean }) {
  const { trade, value, teamNames } = card;
  const aName = teamNames[trade.team_a] ?? `Team ${trade.team_a}`;
  const bName = teamNames[trade.team_b] ?? `Team ${trade.team_b}`;
  const winnerName = value.winner === trade.team_a ? aName : bName;
  // Either no week has been played since the trade, or the whole deal was
  // kickers and defences. Both mean there is no verdict to give.
  const ungraded = !value.graded;

  return (
    <article className="card trade-card">
      <header className="trade-head">
        <span className="eyebrow">
          Week {trade.effective_week}
          {trade.accepted_at &&
            ` \u00b7 ${new Date(trade.accepted_at).toLocaleDateString('en-US',
              { month: 'short', day: 'numeric' })}`}
        </span>
        {trade.confidence === 'reciprocal' && (
          <span className="tag era" title="Reconstructed from roster movement: ESPN kept no transaction record for this season.">
            Reconstructed
          </span>
        )}
        {trade.confidence === 'manual' && (
          <span className="tag era" title="Entered by hand from the league's own records.">
            From the record
          </span>
        )}
        {ungraded ? (
          <span className="tag">Not scored yet</span>
        ) : value.mutual ? (
          <span className="tag best">Both sides won</span>
        ) : value.winner === null ? (
          <span className="tag">Dead even</span>
        ) : (
          <span className="tag best">{winnerName} by {Math.abs(value.margin).toFixed(1)}</span>
        )}
      </header>

      <div className="trade-sides">
        <TradeSide card={card} teamId={trade.team_a} accent="var(--accent)"
                   side={value.a} ahead={value.winner === trade.team_a} />
        <TradeSide card={card} teamId={trade.team_b} accent="var(--gold)"
                   side={value.b} ahead={value.winner === trade.team_b} />
      </div>

      <p className="note trade-basis">
        {ungraded
          ? value.weeksScored === 0
            ? 'No week has been played since this trade, so there is nothing to score yet.'
            : 'Kickers and defences are left out of the scoring, and there was nothing else in this trade.'
          : `Points added to each side's best possible lineup from week ${trade.effective_week} on, ` +
            `against the roster they would have had without the trade. ` +
            `${value.weeksScored} week${value.weeksScored === 1 ? '' : 's'} counted.`}
      </p>

      <TradeVote
        season={trade.season}
        tradeId={trade.trade_id}
        sides={[[trade.team_a, aName], [trade.team_b, bName]]}
        initial={vote?.mine ?? null}
        tally={vote?.tally ?? {}}
        signedIn={signedIn}
        open={votingOpen(trade)}
        closesAt={trade.voting_closes_at}
      />
    </article>
  );
}

export default async function Trades({
  searchParams,
}: { searchParams: Promise<{ season?: string }> }) {
  const sp = await searchParams;
  const [seasons, current, { userId }] = await Promise.all([
    tradeSeasons(), getCurrentSeason(), auth(),
  ]);
  const season = Number(sp.season) || current || seasons[0] || new Date().getUTCFullYear();

  const [cards, records] = await Promise.all([
    getCachedSeasonTrades(season),
    getCachedTradeRecords(),
  ]);
  // Votes need a session and the member's identity; a signed-out visitor sees
  // the trades and the grades, just not the ballot.
  const votes: Record<string, VoteState> =
    userId ? await tradeVotes(season).catch(() => ({})) : {};

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">{season} season</div>
        <h1>Trades</h1>
        <p>
          Every trade, who actually won it, and what the league thought at the time.
        </p>
      </div>

      {/* An accepted trade is not a trade yet. ESPN holds it in a review
          window, and nothing here can see it until the players actually move
          and the Tuesday run picks that up -- so the league will otherwise
          wonder why a deal everyone just agreed to is missing. */}
      {season === current && (
        <p className="note trade-pending-note">
          A trade appears here once ESPN actually moves the players. An accepted
          deal sits in ESPN&rsquo;s review window first, and this page picks it up
          on the following Tuesday &mdash; so a trade agreed this week shows up
          next week.
        </p>
      )}

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

            <p><strong>Where these came from.</strong> ESPN publishes no trade
              contents, so they are reconstructed from weekly rosters. From 2026
              the transaction ledger explains every waiver move, so a player who
              changes teams with nothing to explain it was traded. Earlier seasons
              have no transactions at all, so only genuine two-way swaps are
              claimed and those are marked{' '}
              <span className="tag era">Reconstructed</span> &mdash; a one-sided
              deal from those years is invisible, and nothing before 2018 has the
              data.</p>
          </div>
        </details>
      </div>

      <SeasonPicker seasons={seasons} current={season} basePath="/trades"
                    heading="Seasons with trades"
                    note="2018 is as far back as the weekly roster data goes." />
    </>
  );
}
