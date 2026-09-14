import 'server-only';

import { asUser } from './db.ts';

export interface RevealedWeekPick {
  user_id: string;
  display_name: string | null;
  espn_matchup_id: number;
  predicted_winner_team_id: number;
}

/**
 * Everyone's picks become visible only after the database says the week is
 * locked. The RLS policy independently enforces the same rule; the explicit
 * week_is_locked() predicate here is defense in depth and keeps callers honest.
 */
export async function getLockedWeekPicks(season: number, week: number) {
  const [rows] = await asUser<RevealedWeekPick>((q) => [
    q(`select p.user_id, pr.display_name, p.espn_matchup_id, p.predicted_winner_team_id
         from public.predictions p
         left join public.profiles pr on pr.id = p.user_id
        where p.season = $1
          and p.week = $2
          and public.week_is_locked($1, $2)
        order by coalesce(pr.display_name, p.user_id), p.espn_matchup_id`, [season, week]),
  ]);
  return rows ?? [];
}
