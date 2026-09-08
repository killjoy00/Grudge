import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDatabase, execute } from '../tests/models/database.ts';
import { observedPlayerWeeks, scoreStatements } from './player-week.ts';
import { tradeWriteStatements } from './trade-identity.ts';
import { detectTrades } from './trade-history.ts';
import { loadTradeContext, type ModelQuery } from './model-context.ts';
import { tradePublicationStatements } from './model-publish.ts';
import { valueTrade } from './trade-value.ts';
import { valueTradeProduction } from './trade-production.ts';
import { PUBLISHED_TRADE_SQL } from '../lib/model-queries.ts';
import { correctionStatements, type TradeCorrection } from './trade-corrections.ts';

test('canonical scoring, trade reconciliation and publication execute in PostgreSQL', async (t) => {
  const db = await modelDatabase();
  const query: ModelQuery = async (sql, params = []) => (await db.query(sql, params)).rows as never;
  try {
    await t.test('scoring is independent of ownership, idempotent, and never hides conflicts', async () => {
      const scores = observedPlayerWeeks([
        { season:2025,week:1,espn_player_id:10,applied_points:10 },
        { season:2025,week:1,espn_player_id:10,applied_points:10 },
        { season:2025,week:1,espn_player_id:20,applied_points:20 },
        { season:2025,week:3,espn_player_id:10,applied_points:10 },
        { season:2025,week:3,espn_player_id:20,applied_points:20 },
      ], new Map([[10,2],[20,2]]), 'rules');
      assert.equal(scores.length,4);
      await execute(db,scoreStatements(scores));
      await execute(db,scoreStatements(scores));
      assert.equal((await db.query('select * from player_week_scores')).rows.length,4);
      const first = scores[0]!;
      await execute(db,scoreStatements([{...first,source:'nflverse',evidence:'reconstructed',points:99,input_hash:'estimate'}]));
      assert.equal(Number((await db.query<{points:string}>('select points from player_week_scores where week=1 and espn_player_id=10')).rows[0]!.points),10);
      const conflict = observedPlayerWeeks([
        {season:2025,week:2,espn_player_id:30,applied_points:5},
        {season:2025,week:2,espn_player_id:30,applied_points:8},
      ],new Map([[30,2]]),'rules')[0]!;
      assert.equal(conflict.evidence,'conflict'); assert.equal(conflict.points,null);
      await execute(db,scoreStatements([conflict]));
      await assert.rejects(db.query("update player_week_scores set evidence='verified_zero',points=5 where espn_player_id=30"));
    });
    const ledger = (id:string, week=3) => ({id,type:'TRADE_ACCEPT',status:'EXECUTED',scoringPeriodId:week,
      items:[{type:'TRADE',playerId:10,fromTeamId:1,toTeamId:2},{type:'TRADE',playerId:20,fromTeamId:2,toTeamId:1}]});
    const trade = detectTrades(2025,[],[ledger('receipt')])[0]!;
    await t.test('old IDs, votes and manual corrections survive rebuilds', async () => {
      await db.exec(`insert into seasons values(2025,4,2,false);
        insert into trades(season,trade_id,effective_week,team_a,team_b) values(2025,'old-sequence-id',3,1,2);
        insert into trade_players values(2025,'old-sequence-id',10,1,2),(2025,'old-sequence-id',20,2,1);
        insert into trade_votes values('member',2025,'old-sequence-id',1);`);
      await execute(db,tradeWriteStatements(2025,[trade]));
      let rows = (await db.query<{trade_id:string;evidence_status:string}>('select trade_id,evidence_status from trades')).rows;
      assert.equal(rows.length,1); assert.equal(rows[0]!.trade_id,'old-sequence-id');
      await execute(db,tradeWriteStatements(2025,[]));
      assert.equal((await db.query<{evidence_status:string}>('select evidence_status from trades')).rows[0]!.evidence_status,'needs_review');
      assert.equal((await db.query('select * from trade_votes')).rows.length,1);
      assert.equal((await db.query('select * from trade_players')).rows.length,2);
      await execute(db,tradeWriteStatements(2025,[trade]));
      await db.exec("update trades set manually_corrected=true,effective_week=2");
      await execute(db,tradeWriteStatements(2025,[trade]));
      assert.equal((await db.query<{effective_week:number}>('select effective_week from trades')).rows[0]!.effective_week,2);
      await db.exec('update trades set manually_corrected=false');
      await execute(db,tradeWriteStatements(2025,[trade]));
    });
    await t.test('queries use canonical scores and tracked games, with missing-roster gates', async () => {
      await db.exec(`insert into weeks values (2025,1,true),(2025,3,true);
        insert into matchups values(2025,1,1,2,null),(2025,3,1,3,'WINNERS_BRACKET'),(2025,3,2,4,'CONSOLATION');
        insert into players values (10,'A',2,array[2]),(20,'B',2,array[2]);
        insert into roster_entries values (2025,1,1,10,2,true,999),(2025,1,2,20,2,true,999),
          (2025,3,1,20,2,true,999),(2025,3,2,10,2,true,999);`);
      const loaded = await loadTradeContext(query,2025);
      const input = {...trade,moves:trade.players,...loaded.context};
      const fit=valueTrade(input), production=valueTradeProduction(input);
      assert.equal(fit.graded,true); assert.equal(fit.a.lineupImpact,10); assert.equal(fit.b.lineupImpact,0);
      assert.equal(production.graded,true); assert.equal(production.b.playerWeeks,0);
      assert.equal(loaded.context.points.find((p)=>p.espn_player_id===10)?.points,10);
      const saved=(await db.query<{revision_hash:string}>('select revision_hash from trades')).rows[0]!;
      await execute(db,tradePublicationStatements(2025,[{...trade,trade_id:'old-sequence-id',revision_hash:saved.revision_hash}],loaded.context,loaded.fingerprintInput,loaded.evidence));
      assert.equal((await db.query(PUBLISHED_TRADE_SQL)).rows.length,1);
      await db.exec("update trades set revision_hash='corrected'");
      assert.equal((await db.query(PUBLISHED_TRADE_SQL)).rows.length,0,'old grade cannot follow a corrected trade');
      assert.equal((await db.query('select * from trade_grade_results')).rows.length,1,'old result is retained');
      await db.exec('delete from roster_entries where week=3 and espn_team_id=1');
      const missing=await loadTradeContext(query,2025);
      assert.equal(valueTrade({...trade,moves:trade.players,...missing.context}).gradingReason,'incomplete_data');
      assert.equal(valueTradeProduction({...trade,moves:trade.players,...missing.context}).gradingReason,'incomplete_data');
    });
    await t.test('corrections retain the original package and cannot reuse an audit ID', async () => {
      const correction: TradeCorrection={correction_id:'fix-date',season:2025,trade_id:'old-sequence-id',
        reason:'Verified effective week from the original receipt',action:'correct',effective_week:2,
        team_a:1,team_b:2,players:trade.players};
      await execute(db,correctionStatements(correction));
      await execute(db,correctionStatements(correction));
      assert.equal((await db.query('select * from trade_corrections')).rows.length,1);
      const previous=(await db.query<{previous_record:{trade:{effective_week:number}}}>('select previous_record from trade_corrections')).rows[0]!;
      assert.equal(previous.previous_record.trade.effective_week,3);
      await assert.rejects(execute(db,correctionStatements({...correction,effective_week:1})));
      await execute(db,tradeWriteStatements(2025,[trade]));
      assert.equal((await db.query<{effective_week:number}>('select effective_week from trades')).rows[0]!.effective_week,2);
      assert.equal((await db.query('select * from trade_votes')).rows.length,1);
    });
    await t.test('public roles cannot publish grades or edit scoring', async () => {
      await db.exec('set role app_user');
      await assert.rejects(db.query("update player_week_scores set points=999"));
      await assert.rejects(db.query("insert into model_publications(model_kind,season) values('draft',2026)"));
      await db.exec('reset role');
    });
  } finally {await db.close();}
});
