import { auth } from '@clerk/nextjs/server';
import {
  seasonTrades, tradeSeasons, allTimeTradeRecords, tradeVotes,
  type TradeCard, type VoteState,
} from '../../lib/trade-history-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';
import { SeasonPicker } from '../../components/SeasonPicker.tsx';
import { EspnTeamLink } from '../../components/EspnLink.tsx';
import { TradeVote } from '../../components/TradeVote.tsx';
import { POSITIONS } from '../../pipeline/trade.ts';

export const dynamic = 'force-dynamic';

const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

function TradeSide({
  card, teamId, accent, points, ahead,
}: {
  card: TradeCard; teamId: number; accent: string;
  points: { starterPoints: number; totalPoints: number };
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
        {players.map((p) => (
          <li key={p.espn_player_id}>
            <span className="trade-pos">
              {POSITIONS[p.default_position_id ?? 0] ?? '—'}
            </span>
            {p.full_name ?? `Player ${p.espn_player_id}`}
          </li>
        ))}
      </ul>
      <div className="trade-points">
        <strong>{points.starterPoints.toFixed(1)}</strong> started
        <span className="note"> · {points.totalPoints.toFixed(1)} rostered</span>
      </div>
    </div>
  );
}

function TradeArticle({
  card, vote, signedIn,
}: { card: TradeCard; vote: VoteState | undefined; signedIn: boolean }) {
  const { trade, grade, teamNames } = card;
  const aName = teamNames[trade.team_a] ?? `Team ${trade.team_a}`;
  const bName = teamNames[trade.team_b] ?? `Team ${trade.team_b}`;
  const winnerName = grade.winner === trade.team_a ? aName : bName;

  return (
    <article className="card trade-card">
      <header className="trade-head">
        <span className="eyebrow">
          Week {trade.effective_week}
          {trade.accepted_at &&
            ` · ${new Date(trade.accepted_at).toLocaleDateString('en-US',
              { month: 'short', day: 'numeric' })}`}
        </span>
        {trade.confidence === 'reciprocal' && (
          <span className="tag era" title="Reconstructed from roster movement: ESPN kept no transaction record for this season.">
            Reconstructed
          </span>
        )}
        {grade.verdict === 'ungraded' ? (
          <span className="tag">Not scored yet</span>
        ) : grade.verdict === 'even' ? (
          <span className="tag">Dead even</span>
        ) : (
          <span className="tag best">{winnerName} by {Math.abs(grade.margin).toFixed(1)}</span>
        )}
      </header>

      <div className="trade-sides">
        <TradeSide card={card} teamId={trade.team_a} accent="var(--accent)"
                   points={grade.a} ahead={grade.winner === trade.team_a} />
        <TradeSide card={card} teamId={trade.team_b} accent="var(--gold)"
                   points={grade.b} ahead={grade.winner === trade.team_b} />
      </div>

      <p className="note trade-basis">
        {grade.verdict === 'ungraded'
          ? 'No week has been played since this trade, so there is nothing to score yet.'
          : `Started points only, from week ${trade.effective_week} on, and only while each ` +
            `player stayed on the roster that acquired him. ${grade.weeksScored} week` +
            `${grade.weeksScored === 1 ? '' : 's'} counted so far.`}
      </p>

      <TradeVote
        season={trade.season}
        tradeId={trade.trade_id}
        sides={[[trade.team_a, aName], [trade.team_b, bName]]}
        initial={vote?.mine ?? null}
        tally={vote?.tally ?? {}}
        signedIn={signedIn}
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
    seasonTrades(season),
    allTimeTradeRecords(),
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
            Started points gained minus started points given away, every trade,
            every season. Ranked on points rather than wins and losses, because
            two lopsided trades and two coin flips are not the same record.
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
                    <td>{r.lost_points.toFixed(1)}</td>
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
            Each side is credited with the points its acquired players actually
            <strong> started</strong> from the trade week forward, and only for as long as
            the team that traded for them kept them. Points scored before the
            trade never count for either side; a player you traded for and then
            dropped stops counting the week you drop him. Total rostered points
            sit alongside the started figure, because a player who won you
            nothing from the bench is a different kind of miss.
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
