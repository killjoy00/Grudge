'use server';

/**
 * Voting on trades.
 *
 * As everywhere else in this app, the database is the authority: the
 * trade_votes RLS policies bind a row to its author and the
 * enforce_trade_vote_side trigger rejects a vote for a team that is not in the
 * trade. The checks here exist to turn those refusals into sentences a person
 * can act on.
 */
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { asUser } from './db.ts';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not in trade/i.test(msg)) return "That team isn't in this trade.";
  if (/voting closed/i.test(msg)) return 'Voting on this trade has closed.';
  if (/row-level security/i.test(msg)) return 'You can only change your own vote.';
  if (/violates foreign key/i.test(msg)) return 'That trade no longer exists.';
  if (/not signed in/i.test(msg)) return 'You need to sign in.';
  if (/membership inactive|not provisioned/i.test(msg)) {
    return 'Your league membership is not active. Ask the commissioner to check your account.';
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Vote for the side you think won a trade.
 *
 * Changeable at will, deliberately. A vote is an opinion about a trade whose
 * result is still unfolding, not a locked pick -- and the computed verdict
 * sitting next to it means nobody can quietly rewrite history without it
 * showing.
 */
export async function submitTradeVote(
  season: number,
  tradeId: string,
  teamId: number
): Promise<ActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: 'You need to sign in.' };

    await asUser((q) => [
      q(
        `insert into public.trade_votes (user_id, season, trade_id, voted_team_id)
         values ($1, $2, $3, $4)
         on conflict (user_id, season, trade_id)
         do update set voted_team_id = excluded.voted_team_id, updated_at = now()`,
        [userId, season, tradeId, teamId]
      ),
    ]);
    revalidatePath('/trades');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
