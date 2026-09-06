import { auth } from '@clerk/nextjs/server';
import { tradeSeasons, tradeVotes, votingOpen, type TradeCard, type VoteState }
  from '../../lib/trade-history-queries.ts';
import { getCachedSeasonTrades, getCachedTradeRecords } from '../../lib/cached-queries.ts';
import {
  getAllTimeTradeProductionRecords,
  getTradeProductionForSeason,
  type TradeProductionValue,
} from '../../lib/trade-production-queries.ts';
import { UNGRADED_POSITIONS, type SideValue } from '../../pipeline/trade-value.ts';
import type { ProductionSide } from '../../pipeline/trade-production.ts';
import { getCurrentSeason } from '../../lib/queries.ts';
import { SeasonPicker } from '../../components/SeasonPicker.tsx';
import { EspnTeamLink } from '../../components/EspnLink.tsx';
import { TradeVote } from '../../components/TradeVote.tsx';
import { POSITIONS } from '../../pipeline/trade.ts';

export const dynamic = 'force-dynamic';

const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

function TradeSide({
  card, teamId, accent, side, production, ahead,
}: {
  card: TradeCard; teamId: number; accent: string;
  side: SideValue;
  production: ProductionSide | undefined;
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
        <span className="trade-impact-label">team fit · lineup impact</span>
        <div className="note trade-secondary">
          <span
            className={production && production.value > 0 ? 'up' : production && production.value < 0 ? 'down' : undefined}
            title={production?.playerWeeks
              ? `Actual acquired-player production minus positional replacement across ${production.playerWeeks} owned player-week${production.playerWeeks === 1 ? '' : 's'}.`
              : 'No acquired offensive player-week has been completed while this team owned the player.'}
          >
            {production?.playerWeeks ? signed(production.value) : '—'} player value
          </span>{' · '}
          {side.startedPoints.toFixed(1)} of {side.rosteredPoints.toFixed(1)} acquired points started
        </div>
      </div>
    </div>
  );
}

function TradeArticle({
  card, production, vote, signedIn,
}: {
  card: TradeCard;
  production: TradeProductionValue | undefined;
  vote: VoteState | undefined;
  signedIn: boolean;
}) {
  const { trade, value, teamNames } = card;
  const aName = teamNames[trade.team_a] ?? `Team ${trade.team_a}`;
  const bName = teamNames[trade.team_b] ?? `Team ${trade.team_b}`;
  const winnerName = value.winner === trade.team_a ? aName : bName;
  const productionWinner = production?.winner === trade.team_a ? aName
    : production?.winner === trade.team_b ? bName : null;
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
          <span className="tag era" title="Reconstructed from reciprocal weekly roster movement because the completed ESPN item list did not survive.">
            Reconstructed
          </span>
        )}
        {trade.confidence === 'manual' && (
          <span className="tag era" title="Entered by hand from the league's own records.">
            From the record
          </span>
        )}
        {ungraded ? (
          <span className="tag">Team fit: not scored yet</span>
        ) : value.mutual ? (
          <span className="tag best">Team fit: both improved</span>
        ) : value.winner === null ? (
          <span className="tag">Team fit: dead even</span>
        ) : (
          <span className="tag best">Team fit: {winnerName} by {Math.abs(value.margin).toFixed(1)}</span>
        )}
        {production?.graded && (
          productionWinner
            ? <span className="tag era">Player value: {productionWinner} by {Math.abs(production.margin).toFixed(1)}</span>
            : <span className="tag era">Player value: dead even</span>
        )}
      </header>

      <div className="trade-sides">
        <TradeSide card={card} teamId={trade.team_a} accent="var(--accent)"
                   side={value.a} production={production?.a} ahead={value.winner === trade.team_a} />
        <TradeSide card={card} teamId={trade.team_b} accent="var(--gold)"
                   side={value.b} production={production?.b} ahead={value.winner === trade.team_b} />
      </div>

      <p className="note trade-basis">
        {ungraded
          ? value.weeksScored === 0
            ? 'No week has been played since this trade, so there is nothing to score yet.'
            : 'Kickers and defences are left out of the scoring, and there was nothing else in this trade.'
          : `Team fit measures points added to each side's best possible lineup from week ${trade.effective_week} on. ` +
            `Player value separately measures the acquired players' actual production above their positional replacement baselines, ` +
            `whether or not someone else on that roster was even better.`}
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

type LedgerRow = {
  franchiseKey: string;
  name: string;
  trades: number;
  won: number;
  lost: number;
  even: number;
  gained: number;
  given: number;
  net: number;
};

function TradeLedger({ title, note, rows, valueLabels }: {
  title: string;
  note: string;
  rows: LedgerRow[];
  valueLabels: [string, string];
}) {
  return (
    <div className="card">
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <p className="note" style={{ marginTop: 6 }}>{note}</p>
      <div className="scroll" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Manager</th><th>Trades</th><th>W–L</th>
              <th>{valueLabels[0]}</th><th>{valueLabels[1]}</th><th>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.franchiseKey}>
                <td>{r.name}</td>
                <td>{r.trades}</td>
                <td>{r.won}–{r.lost}{r.even ? `–${r.even}` : ''}</td>
                <td>{r.gained.toFixed(1)}</td>
                <td>{r.given.toFixed(1)}</td>
                <td className={r.net > 0 ? 'up' : r.net < 0 ? 'down' : ''}>{signed(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

  const [cards, records, productionByTrade, productionRecords] = await Promise.all([
    getCachedSeasonTrades(season),
    getCachedTradeRecords(),
    getTradeProductionForSeason(season),
    getAllTimeTradeProductionRecords(),
  ]);
  const votes: Record<string, VoteState> =
    userId ? await tradeVotes(season).catch(() => ({})) : {};

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">{season} season</div>
        <h1>Trades</h1>
        <p>
          Every trade scored two ways: what it did for the roster, and how good the players themselves were.
        </p>
      </div>

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
                        production={productionByTrade[card.trade.trade_id]}
                        vote={votes[card.trade.trade_id]} signedIn={Boolean(userId)} />
        ))
      )}

      {(records.length > 0 || productionRecords.length > 0) && (
        <>
          <h2>All-time trade ledgers</h2>
          <p className="sub">Same trades, two different questions. Neither rating is treated as the one true answer.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(390px, 1fr))', gap: 14 }}>
            <TradeLedger
              title="Team fit · lineup impact"
              note="Best-lineup points gained minus the best-lineup points gained by your trade partners. This rewards filling actual roster holes."
              rows={records}
              valueLabels={['Gained', 'Given']}
            />
            <TradeLedger
              title="Player value · above replacement"
              note="Actual acquired-player production above positional replacement, independent of whether your roster happened to have an even better option."
              rows={productionRecords}
              valueLabels={['Received', 'Sent']}
            />
          </div>
        </>
      )}

      <div className="card">
        <details>
          <summary>How the two trade grades work</summary>
          <div className="note trade-explainer">
            <p>
              <strong>Team Fit</strong> asks what the deal did to your particular roster. Each week after the trade we take your real roster,
              work out the best lineup it could have fielded, then do the same for the roster you would have had without the trade.
              The difference is the trade&rsquo;s lineup impact. It deliberately does not give full credit for a fourth great running back who never improves the lineup.
            </p>

            <p>
              <strong>Player Value</strong> asks the complementary question: how good were the players you acquired, regardless of your existing roster?
              Every week you still own an acquired QB, RB, WR or TE, his actual fantasy points are compared with the replacement baseline at his position.
              Those values are summed and compared with what the other side received. So if you trade for a very good receiver but a random receiver already on
              your bench happens to outscore him every week, the deal can look mediocre on Team Fit while still looking excellent on Player Value.
            </p>

            <p><strong>Why keep both?</strong> They measure real but different things. Team Fit rewards roster construction and opportunity cost.
              Player Value grades the talent return without letting the rest of the roster obscure it. A smart trade can win one, both, or neither.</p>

            <p><strong>Dropped and re-traded players.</strong> Both models count a player only while the team that acquired him still owns him.
              Kickers and defences are listed as part of the historical trade but excluded from both grades.</p>

            <p><strong>Voting</strong> opens on the Tuesday after the week a trade takes effect and runs for seven days. A deal made between the draft
              and week 1 opens when week 1 finishes and closes when week 2 does; one made during week 1 opens a week after that. This season only.
              Your pick stays private until you make it, then you see the league&rsquo;s.</p>

            <p><strong>Where these came from.</strong> For 2018–2025, completed ESPN transaction envelopes are the source of truth whenever the archive
              preserves the players sent in both directions. Some accepted trades survive only as an empty transaction shell; those are marked{' '}
              <span className="tag era">Reconstructed</span> and are included only when consecutive weekly rosters show players moving both directions
              between the same two teams. A one-way roster change is never called a trade. Nothing before 2018 has the player-level weekly roster history
              needed to grade a trade.</p>
          </div>
        </details>
      </div>

      <SeasonPicker seasons={seasons} current={season} basePath="/trades"
                    heading="Seasons with trades"
                    note="2018 is as far back as the weekly roster data goes." />
    </>
  );
}
