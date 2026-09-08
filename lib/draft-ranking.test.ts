import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRADED_DRAFT_CTE } from './draft-ranking.ts';
import { DRAFT_MODEL_VERSION } from '../pipeline/draft-model.ts';
import { modelDatabase } from '../tests/models/database.ts';

test('published draft SQL executes, preserves verified zero, and gates incomplete boards', async () => {
  const db = await modelDatabase();
  try {
    await db.exec(`
      insert into draft_picks values (2025,1,1,1,1,10),(2025,2,1,2,2,20);
      insert into team_franchise values (2025,1,'one','One'),(2025,2,'two','Two');
      insert into model_runs(run_id,model_kind,model_version,input_hash,coverage)
        values ('r','draft','${DRAFT_MODEL_VERSION}','h','{}');
      insert into model_publications(model_kind,season,run_id) values ('draft',2025,'r');
    `);
    for (const [pick, team, player, points, value] of [[1,1,10,0,-40],[2,2,20,200,20]]) {
      await db.query(`insert into draft_grade_results values ('r',2025,$1,$2,$3,$4)`, [pick,team,player,JSON.stringify({
        total_picks: 2, full_name: `Player ${player}`, position: 2, fantasy_points: points,
        active_weeks: points ? 13 : 0, performance_source: points ? 'nflverse' : 'no_regular_season_stats',
        production_score: points ? 50 : 0, draft_capital_score: points ? 30 : 40, value_delta: value,
      })]);
    }
    const read = () => db.query<{ overall_pick:number; fantasy_points:string; value_delta:string }>(`${GRADED_DRAFT_CTE} select * from graded order by overall_pick`);
    const rows = (await read()).rows;
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[0]!.fantasy_points), 0);
    assert.equal(Number(rows[0]!.value_delta), -40);
    // No player or ownership row exists: neither is required for known production.
    await db.exec('delete from draft_picks where overall_pick = 2');
    assert.equal((await read()).rows.length, 0);
    await db.exec('insert into draft_picks values (2025,2,1,2,2,999)');
    assert.equal((await read()).rows.length, 0, 'a same-size but changed board is not the published board');
    await db.exec('update draft_picks set espn_player_id=20 where overall_pick=2');
    await db.exec("update model_publications set coverage_status='blocked'");
    assert.equal((await read()).rows.length, 0);
  } finally { await db.close(); }
});
