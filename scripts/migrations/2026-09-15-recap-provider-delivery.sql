-- Track what happened after Resend accepted a recap message.
--
-- recap_deliveries.status remains the application send state (`sent` means
-- Resend accepted the request). These columns separately record mailbox-level
-- provider state so delivery/bounce monitoring never weakens send idempotency.

begin;

alter table public.recap_deliveries
  add column if not exists provider_status text,
  add column if not exists provider_status_checked_at timestamptz,
  add column if not exists provider_delivered_at timestamptz,
  add column if not exists provider_failed_at timestamptz,
  add column if not exists provider_error_code text;

comment on column public.recap_deliveries.provider_status is
  'Latest Resend lifecycle state (for example delivered, bounced, complained, opened).';
comment on column public.recap_deliveries.provider_status_checked_at is
  'Last time the Resend Email API was reconciled for this delivery.';
comment on column public.recap_deliveries.provider_delivered_at is
  'First time Grudge observed a provider state proving mailbox delivery.';
comment on column public.recap_deliveries.provider_failed_at is
  'First time Grudge observed a terminal provider failure such as bounce/suppression.';
comment on column public.recap_deliveries.provider_error_code is
  'Sanitized provider lifecycle or lookup failure code; never contains recipient data.';

commit;
