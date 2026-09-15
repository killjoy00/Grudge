-- Store verified Resend lifecycle events without broadening the CI send key.
--
-- The web app connects as app_user and cannot update recap_deliveries directly.
-- These SECURITY DEFINER helpers expose only the two narrow operations the
-- webhook route needs: obtain the provider signing secret server-side and
-- record lifecycle state for a message id already created by the pipeline.

begin;

create table if not exists public.provider_webhook_credentials (
  provider   text primary key check (provider ~ '^[a-z0-9_-]+$'),
  secret     text not null check (length(secret) >= 32),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

revoke all on public.provider_webhook_credentials
  from public, authenticated, app_user, app_pipeline;

create or replace function public.provider_webhook_secret(p_provider text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select secret
    from public.provider_webhook_credentials
   where provider = lower(p_provider)
$$;

revoke all on function public.provider_webhook_secret(text)
  from public, authenticated, app_user, app_pipeline;
grant execute on function public.provider_webhook_secret(text) to app_user;

create or replace function public.record_recap_provider_event(
  p_message_id text,
  p_event text,
  p_event_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_name text := lower(regexp_replace(coalesce(p_event, ''), '^email[.]', ''));
  event_time timestamptz := coalesce(p_event_at, now());
  updated boolean;
begin
  if coalesce(trim(p_message_id), '') = '' then
    return false;
  end if;

  if event_name not in (
    'sent', 'scheduled', 'delivered', 'delivery_delayed',
    'bounced', 'complained', 'opened', 'clicked', 'failed', 'suppressed'
  ) then
    return false;
  end if;

  update public.recap_deliveries
     set provider_status = case
           -- Terminal provider failures are authoritative even if delivery was
           -- observed earlier (for example, a later complaint).
           when event_name in ('bounced', 'complained', 'failed', 'suppressed')
             then event_name
           when provider_status in ('bounced', 'complained', 'failed', 'suppressed')
             then provider_status
           -- Delivered/opened/clicked all prove mailbox delivery and must not
           -- be downgraded by a delayed out-of-order `sent` event.
           when event_name in ('delivered', 'opened', 'clicked')
             then event_name
           when provider_status in ('delivered', 'opened', 'clicked')
             then provider_status
           else event_name
         end,
         provider_status_checked_at = now(),
         provider_delivered_at = case
           when event_name in ('delivered', 'opened', 'clicked')
             then coalesce(provider_delivered_at, event_time)
           else provider_delivered_at
         end,
         provider_failed_at = case
           when event_name in ('bounced', 'complained', 'failed', 'suppressed')
             then coalesce(provider_failed_at, event_time)
           else provider_failed_at
         end,
         provider_error_code = case
           when event_name in ('bounced', 'complained', 'failed', 'suppressed')
             then 'resend_' || event_name
           when provider_status in ('bounced', 'complained', 'failed', 'suppressed')
             then provider_error_code
           else null
         end,
         updated_at = now()
   where provider_message_id = p_message_id;

  get diagnostics updated = row_count;
  return updated;
end $$;

revoke all on function public.record_recap_provider_event(text, text, timestamptz)
  from public, authenticated, app_user, app_pipeline;
grant execute on function public.record_recap_provider_event(text, text, timestamptz)
  to app_user;

comment on table public.provider_webhook_credentials is
  'Server-only signing credentials for external provider webhooks; never readable by league members.';
comment on function public.record_recap_provider_event(text, text, timestamptz) is
  'Narrow app_user webhook mutation for lifecycle state of an already-known recap provider message id.';

commit;
