#!/usr/bin/env -S npx tsx
/**
 * Verify mailbox-level recap delivery from durable provider state.
 *
 * A separate reconciler records Resend lifecycle state in recap_deliveries.
 * This watchdog intentionally does not call the Resend API itself: the CI key
 * is send-only, so delivery verification must not depend on broadening that
 * credential. The job fails once a scheduled verification expects delivery and
 * any eligible member is still pending or in a terminal provider failure state.
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { connect } from './db.ts';

type Query = <T>(text: string, params?: unknown[]) => Promise<T[]>;
type ProviderClass = 'delivered' | 'failed' | 'pending';

const DELIVERED_STATES = new Set(['delivered', 'opened', 'clicked']);
const FAILED_STATES = new Set(['bounced', 'complained', 'failed', 'suppressed']);

interface DeliveryRow {
  member_label: string;
  status: string | null;
  provider_message_id: string | null;
  provider_status: string | null;
}

export interface ProviderObservation {
  providerStatus: string | null;
  hasMessageId: boolean;
  sendStatus: string | null;
}

export interface ProviderAssessment {
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  unsent: number;
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
  let unsent = 0;
  let missingMessageIds = 0;

  for (const observation of observations) {
    if (observation.sendStatus !== 'sent') {
      unsent += 1;
      continue;
    }
    if (!observation.hasMessageId) {
      missingMessageIds += 1;
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
    unsent,
    missingMessageIds,
    complete:
      total > 0 &&
      delivered === total &&
      failed === 0 &&
      pending === 0 &&
      unsent === 0 &&
      missingMessageIds === 0,
  };
}

function queryClient(): Query {
  const sql = connect() as unknown as { query: Query };
  return (text, params = []) => sql.query(text, params);
}

async function loadEligibleRows(query: Query, season: number, week: number): Promise<DeliveryRow[]> {
  return query<DeliveryRow>(
    `with eligible as (
       select p.email,
              coalesce(nullif(trim(p.display_name), ''), split_part(p.email::text, '@', 1))
                as member_label
         from public.profiles p
         join public.league_allowlist a on a.email = p.email
        where p.is_active and a.is_active and p.recap_email_enabled
     )
     select e.member_label,
            d.status,
            d.provider_message_id,
            d.provider_status
       from eligible e
       left join public.recap_deliveries d
         on d.season = $1 and d.week = $2 and d.recipient_email = e.email
      order by e.member_label`,
    [season, week]
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
      `provider_unsent=${assessment.unsent}`,
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
  const rows = await loadEligibleRows(query, season, week);
  if (rows.length === 0) throw new Error('No active league members are eligible for recap email.');

  const observations: ProviderObservation[] = rows.map((row) => ({
    providerStatus: row.provider_status,
    hasMessageId: Boolean(row.provider_message_id),
    sendStatus: row.status,
  }));
  const assessment = assessProviderDelivery(observations);
  writeGithubOutputs(assessment);

  console.log(
    `${season} week ${week}: provider state confirms ${assessment.delivered}/${assessment.total} delivered; ` +
    `${assessment.pending} pending, ${assessment.failed} provider failure(s), ` +
    `${assessment.unsent} not accepted, ${assessment.missingMessageIds} missing message id(s).`
  );

  for (const row of rows) {
    const label = row.member_label || 'member';
    if (row.status !== 'sent') {
      console.error(`  ${label}: recap send state is ${row.status ?? 'missing'}`);
      continue;
    }
    if (!row.provider_message_id) {
      console.error(`  ${label}: sent row has no provider message id`);
      continue;
    }
    const classification = classifyProviderStatus(row.provider_status);
    if (classification === 'failed') {
      console.error(`  ${label}: provider ${normalizeProviderStatus(row.provider_status)}`);
    } else if (classification === 'pending') {
      console.warn(`  ${label}: provider ${normalizeProviderStatus(row.provider_status)}`);
    }
  }

  if (assessment.failed > 0) {
    throw new Error(`${assessment.failed} recap email(s) reached a terminal provider failure state.`);
  }
  if (assessment.unsent > 0 || assessment.missingMessageIds > 0) {
    throw new Error(
      `${assessment.unsent + assessment.missingMessageIds} recap delivery record(s) are incomplete.`
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
    console.error(`\nprovider delivery verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
