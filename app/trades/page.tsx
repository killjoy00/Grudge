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
          {signed(side.playerValue)} over replacement ·{' '}
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
          <summary>How a trade is scored, and where these came from</summary>
          <p className="note" style={{ marginTop: 10 }}>
            A trade is scored by what it did to your lineup, not by adding up
            points. For every week from the trade forward we take the roster you
            actually had, work out the best lineup it could have fielded from
            what those players really scored, then do the same for the roster
            you <em>would</em> have had &mdash; the players you received taken back
            out, the players you gave up put back in. The difference is what the
            trade was worth that week. Add up the weeks.
            <br /><br />
            Position adjusts itself that way, exactly. A tight end who fills an
            empty TE slot is worth all of his points; a fourth running back is
            worth whatever he adds over the third, which is usually nothing.
            That is also what stops a 2-for-4 reading as a rout for whoever
            received four bodies: the extra two only count in the weeks they
            would genuinely have started. Byes and injuries need no special case
            either, and because it uses your <em>best</em> lineup rather than the
            one you set, it scores the trade and not your Sunday morning. What
            you actually started is reported next to it, because winning a trade
            and benching the guy is its own kind of story.
            <br /><br />
            A traded player counts only while the team that got him keeps him.
            Cut someone you traded for and you are left with the hole where the
            player you gave up used to be. Cut someone you were traded and he
            stops counting for the other side too &mdash; you cannot lose a trade
            to a player your rival threw away.
            <br /><br />
            Because the two sides are measured against different rosters, both
            can come out ahead. That is not a bug in the arithmetic; it is what a
            good trade looks like, and it is labelled when it happens.
            <br /><br />
            Kickers and defences are left out entirely. Nobody trades for a
            kicker on purpose, and when one rides along in a deal his points are
            noise that can move a verdict without meaning anything. They are
            still listed &mdash; the trade happened &mdash; just marked as not
            counted.
            <br /><br />
            ESPN does not publish what was in a trade. The only record it serves
            is an acceptance envelope with an empty item list, pointing at a
            proposal no endpoint returns. So the contents here are reconstructed
            from what it does serve — weekly rosters — by two rules.
            <br /><br />
            From 2026 on, the transaction ledger accounts for every waiver claim
            and drop, so a player who changes teams with nothing to explain it
            was traded. That was checked before it was trusted: replaying every
            draft, waiver and roster move over 161 players reproduced all ten
            current rosters exactly, which is what makes an unexplained move
            evidence rather than a gap.
            <br /><br />
            The archived seasons back to 2018 kept weekly rosters but no
            transactions at all, so there a waiver claim and a one-sided trade
            are indistinguishable. Only a genuine two-way swap is claimed for
            those years — both teams receiving somebody in the same week — and
            those trades are marked <span className="tag era">Reconstructed</span>.
            It separates cleanly: about twenty one-way waiver moves a season
            against two to six swaps. The cost is that a one-sided deal before
            2026 is invisible, and 2005–2017 predates the roster data entirely.
          </p>
        </details>
      </div>

      <SeasonPicker seasons={seasons} current={season} basePath="/trades"
                    heading="Seasons with trades"
                    note="Only seasons ESPN gave us transactions for appear here." />
    </>
  );
}
