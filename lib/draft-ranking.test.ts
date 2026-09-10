import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_PICK_SORT, GRADED_DRAFT_CTE } from './draft-ranking.ts';
import { DRAFT_MODEL_VERSION } from '../pipeline/draft-model.ts';
import { modelDatabase } from '../tests/models/database.ts';

test('published draft SQL trusts ready coverage, preserves canonical identity, verified zero, and gates changed boards', async () => {
  const db = await modelDatabase();
  try {
    await db.exec(`
      insert into nfl_players(player_key,full_name,position,bio)
        values ('espn:10','Player 10','RB','{}'),('espn:20','Player 20','RB','{}');
      insert into nfl_player_aliases(season,espn_player_id,player_key,match_method)
        values (2025,10,'espn:10','provider_id'),(2025,20,'espn:20','provider_id');
      insert into draft_picks values (2025,1,1,1,1,10),(2025,2,1,2,2,20);
      insert into team_franchise values (2025,1,'one','One'),(2025,2,'two','Two');
      insert into model_runs(run_id,model_kind,model_version,input_hash,coverage)
        values ('r','draft','${DRAFT_MODEL_VERSION}','h','{}');
      insert into model_publications(model_kind,season,run_id) values ('draft',2025,'r');
    `);
    for (const [pick, team, player, points, value] of [[1,1,10,0,-40],[2,2,20,200,20]]) {
      await db.query(`insert into draft_grade_results
        (run_id,season,overall_pick,espn_team_id,espn_player_id,player_key,result)
        values ('r',2025,$1,$2,$3,$4,$5)`, [pick,team,player,`espn:${player}`,JSON.stringify({
        // The full board has one explicitly-accounted excluded slot that is not
        // a graded player row. A ready publication remains visible anyway.
        total_picks: 3, full_name: `Player ${player}`, position: 2, fantasy_points: points,
        active_weeks: points ? 13 : 0, performance_source: points ? 'nflverse' : 'no_regular_season_stats',
        production_score: points ? 50 : 0, draft_capital_score: points ? 30 : 40, value_delta: value,
      })]);
    }
    const read = () => db.query<{ overall_pick:number; player_key:string; fantasy_points:string; value_delta:string }>(`${GRADED_DRAFT_CTE} select * from graded order by overall_pick`);
    const rows = (await read()).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.player_key, 'espn:10');
    assert.equal(Number(rows[0]!.fantasy_points), 0);
    assert.equal(Number(rows[0]!.value_delta), -40);
    // A published graded pick disappearing or changing still invalidates the season.
    await db.exec('delete from draft_picks where overall_pick = 2');
    assert.equal((await read()).rows.length, 0);
    await db.exec('insert into draft_picks values (2025,2,1,2,2,999)');
    assert.equal((await read()).rows.length, 0, 'a changed board is not the published board');
    await db.exec('update draft_picks set espn_player_id=20 where overall_pick=2');
    await db.exec("update model_publications set coverage_status='blocked'");
    assert.equal((await read()).rows.length, 0);
  } finally { await db.close(); }
});

test('draft record ordering stays numeric even when displayed values are text', async () => {
  const db = await modelDatabase();
  try {
    const values = [-48.60, -9.24, -0.08, 9.24, 110.87];
    await db.exec(`
      insert into team_franchise values (2024,1,'one','One');
      insert into model_runs(run_id,model_kind,model_version,input_hash,coverage)
        values ('sort','draft','${DRAFT_MODEL_VERSION}','h','{}');
      insert into model_publications(model_kind,season,run_id) values ('draft',2024,'sort');
    `);
    for (let index = 0; index < values.length; index += 1) {
      const pick = index + 1;
      const player = 100 + pick;
      const value = values[index]!;
      await db.query(`insert into nfl_players(player_key,full_name,position,bio)
        values($1,$2,'RB','{}')`, [`espn:${player}`, `Player ${player}`]);
      await db.query('insert into draft_picks values (2024,$1,1,$1,1,$2)', [pick, player]);
      await db.query(`insert into draft_grade_results
        (run_id,season,overall_pick,espn_team_id,espn_player_id,player_key,result)
        values ('sort',2024,$1,1,$2,$3,$4)`, [pick, player, `espn:${player}`, JSON.stringify({
        total_picks: values.length,
        full_name: `Player ${player}`,
        position: 2,
        fantasy_points: 100 + pick,
        active_weeks: 10,
        performance_source: 'nflverse',
        production_score: 50,
        draft_capital_score: 50 - value,
        value_delta: value,
      })]);
    }

    const busts = await db.query<{ value_delta: string }>(`${GRADED_DRAFT_CTE}
      select value_delta::text as value_delta from graded order by ${DRAFT_PICK_SORT.busts}`);
    const steals = await db.query<{ value_delta: string }>(`${GRADED_DRAFT_CTE}
      select value_delta::text as value_delta from graded order by ${DRAFT_PICK_SORT.steals}`);

    assert.deepEqual(busts.rows.map((row) => Number(row.value_delta)), [-48.60, -9.24, -0.08, 9.24, 110.87]);
    assert.deepEqual(steals.rows.map((row) => Number(row.value_delta)), [110.87, 9.24, -0.08, -9.24, -48.60]);
  } finally { await db.close(); }
});