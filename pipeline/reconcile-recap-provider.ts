#!/usr/bin/env -S npx tsx
/**
 * Reconcile accepted recap sends against Resend's mailbox-level lifecycle state.
 *
 * send-recap.ts deliberately keeps recap_deliveries.status = 'sent' once Resend
 * accepts a message so retries remain idempotent. This script records the
 * separate provider outcome (delivered, bounced, complained, suppressed, etc.)
 * and can fail a watchdog once every eligible recipient is expected to have
 * reached an actually-delivered state.
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { connect } from './db.ts';

type Query = <T>(text: string, params?: unknown[]) => Promise<T[]>;

type ProviderClass = 'delivered' | 'failed' | 'pending';

const DELIVERED_STATES = new Set(['delivered', 'opened', 'clicked']);
const FAILED_STATES = new Set(['bounced', 'complained', 'failed', 'suppressed']);

interface DeliveryRow {
  recipient_email: string;
  status: string | null;
  provider_message_id: string | null;
}

export interface ProviderObservation {
  providerStatus: string | null;
  hasMessageId: boolean;
  lookupError: string | null;
}

export interface ProviderAssessment {
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  lookupErrors: number;
  missingMessageIds: number;
  complete: boolean;
}

function positiveInt(value: string | undefined, name: string, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}.`);
  }
  return parsed;
}

export function normalizeProviderStatus(value: unknown): string {
  const normalized = String(value ?? 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 60);
  return normalized || 'unknown';
}

export function classifyProviderStatus(status: string | null): ProviderClass {
  const normalized = normalizeProviderStatus(status);
  if (DELIVERED_STATES.has(normalized)) return 'delivered';
  if (FAILED_STATES.has(normalized)) return 'failed';
  return 'pending';
}

export function assessProviderDelivery(observations: ProviderObservation[]): ProviderAssessment {
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  let lookupErrors = 0;
  let missingMessageIds = 0;

  for (const observation of observations) {
    if (!observation.hasMessageId) {
      missingMessageIds += 1;
      continue;
    }
    if (observation.lookupError) {
      lookupErrors += 1;
      continue;
    }
    const classified = classifyProviderStatus(observation.providerStatus);
    if (classified === 'delivered') delivered += 1;
    else if (classified === 'failed') failed += 1;
    else pending += 1;
  }

  const total = observations.length;
  return {
    total,
    delivered,
    failed,
    pending,
    lookupErrors,
    missingMessageIds,
    complete:
      total > 0 &&
      delivered === total &&
      failed === 0 &&
      pending === 0 &&
      lookupErrors === 0 &&
      missingMessageIds === 0,
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to reconcile recap delivery.`);
  return value;
}

function queryClient(): Query {
  const sql = connect() as unknown as { query: Query };
  return (text, params = []) => sql.query(text, params);
}

function safeProviderCode(value: unknown): string {
  return String(value ?? 'unknown_error')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 60) || 'unknown_error';
}

async function fetchProviderStatus(
  apiKey: string,
  messageId: string
): Promise<{ status: string | null; error: string | null }> {
  let response: Response;
  try {
    response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(messageId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { status: null, error: 'resend_lookup_network_error' };
  }

  const payload = await response.json().catch(() => ({})) as {
    last_event?: unknown;
    status?: unknown;
    name?: unknown;
  };

  if (!response.ok) {
    return {
      status: null,
      error: `resend_lookup_${response.status}_${safeProviderCode(payload.name)}`,
    };
  }

  return {
    status: normalizeProviderStatus(payload.last_event ?? payload.status),
    error: null,
  };
}

async function loadEligibleRows(query: Query, season: number, week: number): Promise<DeliveryRow[]> {
  return query<DeliveryRow>(
    `with eligible as (
       select p.email
         from public.profiles p
         join public.league_allowlist a on a.email = p.email
        where p.is_active and a.is_active and p.recap_email_enabled
     )
     select e.email::text as recipient_email,
            d.status,
            d.provider_message_id
       from eligible e
       left join public.recap_deliveries d
         on d.season = $1 and d.week = $2 and d.recipient_email = e.email
      order by e.email`,
    [season, week]
  );
}

async function persistObservation(
  query: Query,
  season: number,
  week: number,
  recipient: string,
  observation: ProviderObservation
): Promise<void> {
  if (observation.lookupError) {
    await query(
      `update public.recap_deliveries
          set provider_status_checked_at = now(),
              provider_error_code = $4,
              updated_at = now()
        where season = $1 and week = $2 and recipient_email = $3::citext`,
      [season, week, recipient, observation.lookupError]
    );
    return;
  }

  if (!observation.providerStatus) return;
  const classification = classifyProviderStatus(observation.providerStatus);
  await query(
    `update public.recap_deliveries
        set provider_status = $4,
            provider_status_checked_at = now(),
            provider_delivered_at = case
              when $5 then coalesce(provider_delivered_at, now())
              else provider_delivered_at
            end,
            provider_failed_at = case
              when $6 then coalesce(provider_failed_at, now())
              else provider_failed_at
            end,
            provider_error_code = case
              when $6 then 'resend_' || $4
              else null
            end,
            updated_at = now()
      where season = $1 and week = $2 and recipient_email = $3::citext`,
    [
      season,
      week,
      recipient,
      observation.providerStatus,
      classification === 'delivered',
      classification === 'failed',
    ]
  );
}

function writeGithubOutputs(assessment: ProviderAssessment) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  appendFileSync(
    output,
    [
      `provider_total=${assessment.total}`,
      `provider_delivered=${assessment.delivered}`,
      `provider_failed=${assessment.failed}`,
      `provider_pending=${assessment.pending}`,
      `provider_lookup_errors=${assessment.lookupErrors}`,
      `provider_missing_ids=${assessment.missingMessageIds}`,
      `provider_complete=${assessment.complete}`,
      '',
    ].join('\n')
  );
}

async function main() {
  const args = process.argv.slice(2);
  const requireDelivered = args.includes('--require-delivered');
  const season = positiveInt(
    args.find((arg) => arg.startsWith('--season='))?.split('=')[1],
    '--season',
    2100
  );
  if (season < 2018) throw new Error('--season must be 2018 or later.');
  const week = positiveInt(
    args.find((arg) => arg.startsWith('--week='))?.split('=')[1],
    '--week',
    18
  );

  const query = queryClient();
  const apiKey = required('RESEND_API_KEY');
  const rows = await loadEligibleRows(query, season, week);
  if (rows.length === 0) throw new Error('No active league members are eligible for recap email.');

  const observations: ProviderObservation[] = [];
  for (const row of rows) {
    if (row.status !== 'sent') {
      observations.push({
        providerStatus: null,
        hasMessageId: Boolean(row.provider_message_id),
        lookupError: 'recap_not_marked_sent',
      });
      continue;
    }
    if (!row.provider_message_id) {
      observations.push({ providerStatus: null, hasMessageId: false, lookupError: null });
      continue;
    }

    const provider = await fetchProviderStatus(apiKey, row.provider_message_id);
    const observation: ProviderObservation = {
      providerStatus: provider.status,
      hasMessageId: true,
      lookupError: provider.error,
    };
    observations.push(observation);
    await persistObservation(query, season, week, row.recipient_email, observation);
  }

  const assessment = assessProviderDelivery(observations);
  writeGithubOutputs(assessment);
  console.log(
    `${season} week ${week}: Resend confirms ${assessment.delivered}/${assessment.total} delivered; ` +
    `${assessment.pending} pending, ${assessment.failed} provider failure(s), ` +
    `${assessment.lookupErrors} lookup error(s), ${assessment.missingMessageIds} missing message id(s).`
  );

  if (assessment.failed > 0) {
    throw new Error(`${assessment.failed} recap email(s) reached a terminal Resend failure state.`);
  }
  if (assessment.lookupErrors > 0 || assessment.missingMessageIds > 0) {
    throw new Error(
      `Could not verify ${assessment.lookupErrors + assessment.missingMessageIds} recap email(s) with Resend.`
    );
  }
  if (requireDelivered && !assessment.complete) {
    throw new Error(
      `${assessment.delivered}/${assessment.total} recap email(s) are confirmed delivered; ` +
      `${assessment.pending} remain pending.`
    );
  }
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\nprovider delivery reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
