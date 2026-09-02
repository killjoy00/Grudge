-- transactions.status must be nullable, because ESPN does not always send one.
--
-- The column was written not-null on the evidence available at the time: every
-- transaction then in the archive was a DRAFT, and every DRAFT carries
-- status 'EXECUTED'. The schema note even says "CONFIRMED: 'EXECUTED'", which
-- was true of the data and false as a rule.
--
-- A TRADE_ACCEPT envelope has no `status` field at all. It carries
-- executionType 'EXECUTE', isPending false, an empty items array and a
-- relatedTransactionId pointing at the proposal that does carry the status.
-- The first accepted trade of the 2026 preseason therefore failed the whole
-- weekly run:
--
--   pipeline failed: null value in column "status" of relation "transactions"
--                    violates not-null constraint
--
-- Storing null is the honest record: it means ESPN did not say. Defaulting to
-- 'EXECUTED' would assert something ESPN never sent, and nothing reads this
-- column, so there is no consumer to protect from the null.
--
-- Run once as the Neon database owner. Idempotent: a retry is safe.

begin;

alter table public.transactions alter column status drop not null;

comment on column public.transactions.status is
  'ESPN transaction status. Null where ESPN sends none -- TRADE_ACCEPT, for one.';

commit;
