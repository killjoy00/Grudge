'use server';

/**
 * Server actions for predictions and league-profile preferences.
 *
 * These run as `app_user` with the caller's identity set for the transaction,
 * so the database is what actually enforces the rules. The checks here are for
 * good ERROR MESSAGES, not for security: if every line below were deleted, a
 * malicious caller would still be stopped by RLS and the
 * enforce_prediction_lock trigger. That ordering is deliberate -- UI-layer
 * checks drift, database constraints do not.
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
  // Surface the database's own refusals in language a person can act on.
  if (/not the current prediction week/i.test(msg)) return 'That week is not open for picks yet.';
  if (/is locked/i.test(msg)) return 'That week is locked — picks closed Saturday at midnight ET.';
  if (/not in matchup/i.test(msg)) return "That team isn't playing in that matchup.";
  if (/row-level security/i.test(msg)) return 'That pick is not allowed for this week.';
  if (/not signed in/i.test(msg)) return 'You need to sign in.';
  if (/membership inactive|not provisioned/i.test(msg)) {
    return 'Your league membership is not active. Ask the commissioner to check your account.';
  }
  return 'Something went wrong. Please try again.';
}

/** Submit or change a pick. The lock and current-week rule are enforced by the database. */
export async function submitPick(
  season: number,
  week: number,
  matchupId: number,
  teamId: number
): Promise<ActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: 'You need to sign in.' };

    const [rows] = await asUser<{ id: string }>((q) => [
      q(
        `insert into public.predictions
           (user_id, season, week, espn_matchup_id, predicted_winner_team_id)
         select $1, $2, $3, $4, $5
          where public.prediction_week_is_current($2, $3)
         on conflict (user_id, season, espn_matchup_id)
         do update set predicted_winner_team_id = excluded.predicted_winner_team_id,
                       updated_at = now()
         returning id`,
        [userId, season, week, matchupId, teamId]
      ),
    ]);
    if (!rows?.length) {
      return { ok: false, error: 'That week is not open for picks yet.' };
    }
    revalidatePath('/predictions');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function updateProfile(
  name: string,
  recapEmailEnabled: boolean
): Promise<ActionResult> {
  try {
    const text = name.trim().slice(0, 60);
    if (!text) return { ok: false, error: 'Name cannot be empty.' };
    const { userId } = await auth();
    if (!userId) return { ok: false, error: 'You need to sign in.' };
    // These are the only two profile columns grantable to this role. Team,
    // email, active membership, and administrator status remain protected by
    // column grants and a trigger.
    const [rows] = await asUser<{ id: string }>((q) => [
      q(`update public.profiles
            set display_name = $1,
                recap_email_enabled = $2,
                updated_at = now()
          where id = $3
          returning id`, [text, recapEmailEnabled, userId]),
    ]);
    if (!rows?.length) {
      return { ok: false, error: 'Your league profile has not been provisioned yet.' };
    }
    revalidatePath('/');
    revalidatePath('/me');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}