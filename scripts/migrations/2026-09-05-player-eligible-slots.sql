-- Each player's eligible lineup slots, so the trade model can run from the
-- database instead of only from the raw archives.
--
-- This is the one thing that kept the trade finder a CLI. ESPN ships
-- `eligibleSlots` on every player -- it is what encodes that a RB may fill
-- FLEX and a kicker may not fill anything else -- but it had no column here,
-- so pipeline/trades.ts read the gzipped payloads directly rather than
-- half-wiring a page that would silently show nothing.
--
-- Stored as the raw ESPN slot ids, not a decoded position list. The ids are
-- what bestLineup() matches against, and translating them here would mean
-- keeping a second copy of ESPN's slot table in sync with theirs.
--
-- Run once as the Neon database owner. Idempotent: a retry is safe.
-- Values are populated by the normal pipeline run, from the archives.

begin;

alter table public.players
  add column if not exists eligible_slots integer[];

comment on column public.players.eligible_slots is
  'ESPN lineup slot ids this player may legally fill. Null until a boxscore carrying them has been loaded.';

commit;
