'use client';
import { useState, useTransition } from 'react';
import { submitTradeVote } from '../lib/trade-actions.ts';

/**
 * Two buttons and, once you have committed, the league's tally.
 *
 * The tally is withheld until you vote for the same reason the predictions
 * page withholds other people's picks: a running count next to an unanswered
 * question is not a vote, it is a suggestion. The withholding is enforced by
 * the trade_votes select policy, so an unvoted trade simply arrives here with
 * an empty tally -- there is nothing for this component to hide.
 */
export function TradeVote({
  season, tradeId, sides, initial, tally, signedIn, open, closesAt,
}: {
  season: number;
  tradeId: string;
  /** [teamId, name] for each side, in the order they should be shown. */
  sides: [number, string][];
  initial: number | null;
  tally: Record<number, number>;
  signedIn: boolean;
  /** Whether the window is still open. The database refuses a late vote too. */
  open: boolean;
  closesAt: string | null;
}) {
  const [vote, setVote] = useState(initial);
  const [counts, setCounts] = useState(tally);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function choose(teamId: number) {
    const previous = vote;
    setVote(teamId); // optimistic
    setErr(null);
    // The tally the server sent is the one before this vote, so nudge it here
    // rather than showing a stale count until the next page load.
    setCounts((c) => {
      const next = { ...c };
      if (previous != null) next[previous] = Math.max(0, (next[previous] ?? 1) - 1);
      next[teamId] = (next[teamId] ?? 0) + 1;
      return next;
    });
    start(async () => {
      const res = await submitTradeVote(season, tradeId, teamId);
      if (!res.ok) {
        setVote(previous);
        setCounts(tally);
        setErr(res.error ?? 'Could not save that vote.');
      }
    });
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  // A closed trade with no votes has nothing to say, so it says nothing rather
  // than showing an empty ballot nobody can fill in.
  if (!open && total === 0 && vote == null) return null;
  if (!signedIn) {
    return (
      <p className="note trade-vote-note">
        {open ? 'Sign in to vote on this trade.' : 'Voting on this trade has closed.'}
      </p>
    );
  }

  return (
    <div className="trade-vote">
      <div className="trade-vote-q">
        {open ? 'Who won it?' : 'The league said'}
      </div>
      <div className="trade-vote-row">
        {sides.map(([teamId, name]) => {
          const n = counts[teamId] ?? 0;
          const share = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <button
              key={teamId}
              type="button"
              className={`pick trade-vote-btn ${vote === teamId ? 'on' : ''}`}
              disabled={pending || !open}
              aria-pressed={vote === teamId}
              onClick={() => choose(teamId)}
            >
              <span className="pick-team">{name}</span>
              {vote != null && (
                <span className="pick-owner">
                  {n} vote{n === 1 ? '' : 's'} · {share}%
                </span>
              )}
            </button>
          );
        })}
      </div>
      {err && <p className="pick-error" role="alert">{err}</p>}
      {open && vote == null && (
        <p className="note trade-vote-note">
          The league&rsquo;s votes appear once you have cast yours.
          {closesAt && ` Voting closes ${new Date(closesAt).toLocaleDateString('en-US',
            { month: 'short', day: 'numeric' })}.`}
        </p>
      )}
      {!open && vote == null && (
        <p className="note trade-vote-note">
          Voting closed before you weighed in.
        </p>
      )}
    </div>
  );
}
