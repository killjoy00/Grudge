import { createHash } from 'node:crypto';
import type { DetectedTrade, DetectedTradePlayer } from './trade-history.ts';
import { stmt, type Stmt } from './db.ts';

const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const sortedMoves = (moves: DetectedTradePlayer[]) => [...moves].sort((a, b) =>
  a.espn_player_id - b.espn_player_id || a.from_team_id - b.from_team_id || a.to_team_id - b.to_team_id);

export function tradeIdentity(season: number, week: number, moves: DetectedTradePlayer[], transactionId: string | null) {
  const key = transactionId ? `espn:${transactionId}` : `roster:${week}:${hash(sortedMoves(moves))}`;
  return { identity_key: key, trade_id: `${season}-${hash(key).slice(0, 24)}` };
}
export function tradeRevision(trade: Pick<DetectedTrade, 'effective_week' | 'team_a' | 'team_b' | 'players'>) {
  return hash([trade.effective_week, trade.team_a, trade.team_b, sortedMoves(trade.players)]);
}

/** Match an old sequence ID by its evidence, never by its sequence number. */
const INPUT = `with incoming as (
  select * from jsonb_to_recordset($2::jsonb) as x(season int, trade_id text, identity_key text,
    effective_week int, team_a int, team_b int, espn_transaction_id text, accepted_at timestamptz,
    confidence text, revision_hash text, players jsonb) where season = $1
)`;

export function tradeWriteStatements(season: number, trades: DetectedTrade[]): Stmt[] {
  const payload = JSON.stringify(trades.map((t) => ({ ...t, players: sortedMoves(t.players), revision_hash: tradeRevision(t) })));
  const params = [season, payload];
  return [
    stmt(`${INPUT}, resolved as (
      select i.*, coalesce((
        select t.trade_id from public.trades t
         where t.season = i.season and (
           t.identity_key = i.identity_key
           or (i.espn_transaction_id is not null and t.espn_transaction_id = i.espn_transaction_id)
           or (t.effective_week = i.effective_week and t.team_a = i.team_a and t.team_b = i.team_b
             and (select jsonb_agg(jsonb_build_object('espn_player_id', p.espn_player_id,
                   'from_team_id', p.from_team_id, 'to_team_id', p.to_team_id) order by p.espn_player_id)
                    from public.trade_players p where p.season = t.season and p.trade_id = t.trade_id) = i.players)
         )
      ), i.trade_id) as durable_id from incoming i
    )
    insert into public.trades (season, trade_id, identity_key, effective_week, team_a, team_b,
      espn_transaction_id, accepted_at, confidence, revision_hash, last_seen_at)
    select season, durable_id, identity_key, effective_week, team_a, team_b,
      espn_transaction_id, accepted_at, confidence, revision_hash, now() from resolved
    on conflict (season, trade_id) do update set
      identity_key = excluded.identity_key, last_seen_at = now(),
      effective_week = case when trades.manually_corrected then trades.effective_week else excluded.effective_week end,
      team_a = case when trades.manually_corrected then trades.team_a else excluded.team_a end,
      team_b = case when trades.manually_corrected then trades.team_b else excluded.team_b end,
      revision_hash = case when trades.manually_corrected then trades.revision_hash else excluded.revision_hash end,
      espn_transaction_id = coalesce(excluded.espn_transaction_id, trades.espn_transaction_id),
      accepted_at = coalesce(excluded.accepted_at, trades.accepted_at),
      confidence = case when trades.manually_corrected then trades.confidence else excluded.confidence end,
      evidence_status = case when trades.manually_corrected or trades.evidence_status = 'retracted'
        then trades.evidence_status else 'active' end`, params),
    stmt(`${INPUT} update public.trades t set evidence_status = 'needs_review'
      where t.season = $1 and not t.manually_corrected and t.evidence_status = 'active'
        and not exists (select 1 from incoming i where i.identity_key = t.identity_key)`, params),
    stmt(`${INPUT} delete from public.trade_players p using public.trades t, incoming i
      where p.season = t.season and p.trade_id = t.trade_id
        and t.season = i.season and t.identity_key = i.identity_key
        and not t.manually_corrected and t.evidence_status = 'active'`, params),
    stmt(`${INPUT} insert into public.trade_players (season, trade_id, espn_player_id, from_team_id, to_team_id)
      select t.season, t.trade_id, p.espn_player_id, p.from_team_id, p.to_team_id
        from incoming i join public.trades t on t.season = i.season and t.identity_key = i.identity_key
        cross join lateral jsonb_to_recordset(i.players)
          as p(espn_player_id bigint, from_team_id int, to_team_id int)
       where not t.manually_corrected and t.evidence_status = 'active'`, params),
    stmt(`update public.trades t set voting_closes_at = now() + public.trade_voting_window()
      where t.season = $1 and t.voting_closes_at is null and t.evidence_status = 'active'
        and exists (select 1 from public.seasons s where s.season = t.season and s.is_current)`, [season]),
  ];
}
