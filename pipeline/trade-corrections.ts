import { stmt, type Stmt } from './db.ts';
import { sortedMoves, tradeRevision } from './trade-identity.ts';
import type { DetectedTradePlayer } from './trade-history.ts';

export interface TradeCorrection {
  correction_id: string; season: number; trade_id: string; reason: string;
  action: 'correct' | 'retract';
  effective_week?: number; team_a?: number; team_b?: number; players?: DetectedTradePlayer[];
}
export function correctionStatements(c: TradeCorrection): Stmt[] {
  if (!c.correction_id?.trim() || !c.trade_id?.trim() || !c.reason?.trim()
    || !Number.isInteger(c.season) || !['correct', 'retract'].includes(c.action)) throw new Error('Correction needs an ID, season, trade ID, action and reason');
  const payload = JSON.stringify(c);
  const out = [stmt(`insert into public.trade_corrections (correction_id, season, trade_id, reason, correction, previous_record)
    values ($1,$2,$3,$4,$5::jsonb,(select jsonb_build_object('trade',to_jsonb(t),'players',
      (select jsonb_agg(to_jsonb(p) order by p.espn_player_id) from public.trade_players p
       where p.season=t.season and p.trade_id=t.trade_id)) from public.trades t
       where t.season=$2 and t.trade_id=$3)) on conflict do nothing`, [c.correction_id,c.season,c.trade_id,c.reason,payload]),
  // Reusing an audit ID for a different correction must abort the whole transaction.
  stmt(`select 1 / case when correction = $2::jsonb then 1 else 0 end
    from public.trade_corrections where correction_id = $1`, [c.correction_id,payload])];
  if (c.action === 'retract') return [...out, stmt(`update public.trades set evidence_status='retracted',
    manually_corrected=true, voting_closes_at=least(voting_closes_at,now()) where season=$1 and trade_id=$2`,[c.season,c.trade_id])];
  const { effective_week: week, team_a: a, team_b: b, players } = c;
  if (!Number.isInteger(week) || week! < 1 || !Number.isInteger(a) || !Number.isInteger(b) || a! <= 0 || a! >= b!
    || !players?.length || new Set(players.map(p=>p.espn_player_id)).size !== players.length
    || players.some(p=>!Number.isSafeInteger(p.espn_player_id) || ![a,b].includes(p.from_team_id)
      || ![a,b].includes(p.to_team_id) || p.from_team_id===p.to_team_id)
    || !players.some(p=>p.from_team_id===a) || !players.some(p=>p.from_team_id===b)) throw new Error('Correction needs a valid week and a complete two-team player package');
  const moves=sortedMoves(players);
  const revision=tradeRevision({effective_week:week!,team_a:a!,team_b:b!,players:moves});
  out.push(stmt(`update public.trades set effective_week=$3,team_a=$4,team_b=$5,revision_hash=$6,
    manually_corrected=true,confidence='manual',evidence_status='active',voting_closes_at=least(voting_closes_at,now())
    where season=$1 and trade_id=$2`,[c.season,c.trade_id,week,a,b,revision]));
  out.push(stmt('delete from public.trade_players where season=$1 and trade_id=$2',[c.season,c.trade_id]));
  out.push(stmt(`insert into public.trade_players
      (season,trade_id,player_key,espn_player_id,from_team_id,to_team_id)
    select $1,$2,a.player_key,x.espn_player_id,x.from_team_id,x.to_team_id
      from jsonb_to_recordset($3::jsonb)
        as x(espn_player_id bigint,from_team_id int,to_team_id int)
      join public.nfl_player_aliases a
        on a.season=$1 and a.espn_player_id=x.espn_player_id`,
    [c.season,c.trade_id,JSON.stringify(moves)]));
  return out;
}
