-- A voting window on trades, and room for trades entered by hand.
--
-- VOTING WINDOW. A vote on a trade is a snap judgement, and its whole appeal
-- is that it was made before anyone knew. Leaving voting open forever turns it
-- into a vote on the result, which is not interesting and is not a prediction.
--
-- The window closes one week after the trade lands, which in practice means
-- "through the next weekly run": the pipeline runs Tuesday mornings, so a
-- trade found on one Tuesday is open until the next. Trades imported by hand
-- from before this feature existed get no window at all -- a null closing time
-- means closed, because pretending a 2019 trade is still live would be silly.
--
-- Enforcement is a trigger rather than a policy expression, so a late vote
-- fails with a sentence the UI can show instead of vanishing as zero rows.
--
-- CONFIDENCE 'manual'. Trades reconstructed from roster movement cannot see a
-- one-sided deal in the seasons that lost their transactions, and cannot see
-- anything at all before 2018. A manually entered trade is neither of the two
-- derived kinds and is labelled as such, so the page never presents somebody's
-- recollection as a reconstruction or the other way round.
--
-- Run once as the Neon database owner. Idempotent: a retry is safe.

begin;

alter table public.trades
  add column if not exists voting_closes_at timestamptz;

comment on column public.trades.voting_closes_at is
  'Votes accepted until this moment. Null means closed -- a hand-entered historical trade.';

-- Widen the confidence check to admit hand-entered trades.
alter table public.trades drop constraint if exists trades_confidence_check;
alter table public.trades
  add constraint trades_confidence_check
  check (confidence in ('ledger', 'reciprocal', 'manual'));

-- How long a trade stays open once detected. One week, matching the weekly
-- cadence: a trade found on one Tuesday run is open until the next one.
create or replace function public.trade_voting_window()
returns interval language sql immutable as $$ select interval '7 days' $$;

create or replace function public.trade_voting_open(p_season int, p_trade_id text)
returns boolean
language sql stable security definer
set search_path = public as $$
  select coalesce((
    select t.voting_closes_at > now()
      from public.trades t
     where t.season = p_season and t.trade_id = p_trade_id
  ), false);
$$;

revoke all on function public.trade_voting_open(int, text) from public;
grant execute on function public.trade_voting_open(int, text) to authenticated, app_user;

-- Refuse a late vote in words. The existing side check stays where it was; both
-- live in one trigger so the order of the two messages is predictable.
create or replace function public.enforce_trade_vote_side()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if not exists (
    select 1 from public.trades t
     where t.season = new.season and t.trade_id = new.trade_id
       and new.voted_team_id in (t.team_a, t.team_b)
  ) then
    raise exception 'not in trade' using errcode = '23514';
  end if;
  if not public.trade_voting_open(new.season, new.trade_id) then
    raise exception 'voting closed' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Existing rows predate the window and are all historical, so they close now
-- rather than opening for a week the moment this ships.
update public.trades set voting_closes_at = now() where voting_closes_at is null;

commit;
