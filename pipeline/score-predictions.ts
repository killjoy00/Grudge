#!/usr/bin/env -S npx tsx
/**
 * Score predictions for every completed week.
 *
 *   npx tsx pipeline/score-predictions.ts
 *   npx tsx pipeline/score-predictions.ts --dry-run
 *
 * Runs as `app_pipeline`, the only role with write access to
 * prediction_scores. Users have SELECT and nothing else, so nobody can award
 * themselves points -- that is enforced by grant, not by this script being the
 * only caller.
 *
 * Scoring is done in SQL as a single upsert so it is idempotent: re-running
 * recomputes the same rows in place. A pick whose matchup is not yet final is
 * simply not joined, so an in-progress week scores nothing rather than scoring
 * everything as wrong.
 */
import { connect, runTransaction, stmt } from './db.ts';

const DRY_RUN = process.argv.includes('--dry-run');

const SCORE_SQL = `
insert into public.prediction_scores (prediction_id, is_correct, points, scored_at)
select p.id,
       -- The pick is correct when the team picked is the side that won.
       (case m.winner
          when 'HOME' then m.home_team_id
          when 'AWAY' then m.away_team_id
          else null
        end) = p.predicted_winner_team_id                     as is_correct,
       -- A tie scores nothing for anyone; picking either side was neither
       -- right nor wrong, and awarding a point would reward a coin flip.
       (case
          when m.winner = 'TIE' then 0
          when (case m.winner when 'HOME' then m.home_team_id
                              when 'AWAY' then m.away_team_id end)
               = p.predicted_winner_team_id then 1
          else 0
        end)::numeric                                          as points,
       now()
  from public.predictions p
  join public.matchups m
    on m.season = p.season and m.espn_matchup_id = p.espn_matchup_id
 where m.is_final
   and m.winner <> 'UNDECIDED'
on conflict (prediction_id) do update
   set is_correct = excluded.is_correct,
       points     = excluded.points,
       scored_at  = excluded.scored_at`;

async function main() {
  const sql = connect();

  const before = (await (sql as unknown as {
    query: (t: string, p: unknown[]) => Promise<{ n: number }[]>;
  }).query(
    `select count(*)::int as n from public.predictions p
       join public.matchups m on m.season = p.season and m.espn_matchup_id = p.espn_matchup_id
      where m.is_final`, []
  ))[0]?.n ?? 0;

  console.log(`${before} prediction(s) attached to a completed matchup`);
  if (before === 0) {
    console.log('nothing to score yet');
    return;
  }
  if (DRY_RUN) { console.log('--dry-run: nothing written'); return; }

  await runTransaction(sql, [stmt(SCORE_SQL)]);

  const rows = await (sql as unknown as {
    query: (t: string, p: unknown[]) => Promise<{ scored: number; correct: number }[]>;
  }).query(
    `select count(*)::int as scored,
            count(*) filter (where is_correct)::int as correct
       from public.prediction_scores`, []
  );
  const r = rows[0];
  console.log(`scored ${r?.scored ?? 0}, of which ${r?.correct ?? 0} correct`);
}

main().catch((e) => {
  console.error(`scoring failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('Nothing was written -- the run is transactional.');
  process.exit(1);
});
