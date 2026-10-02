#!/usr/bin/env -S npx tsx
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { connect } from '../pipeline/db.ts';

type Receipt = {
  message_hash: string;
  status: string;
};

type ReceiptFile = {
  version: number;
  season: number;
  week: number;
  observed_at: string;
  receipts: Receipt[];
};

const ALLOWED = new Set([
  'sent',
  'scheduled',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'opened',
  'clicked',
  'failed',
  'suppressed',
]);

const DELIVERED = new Set(['delivered', 'opened', 'clicked']);
const FAILED = new Set(['bounced', 'complained', 'failed', 'suppressed']);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseReceiptFile(raw: string): ReceiptFile {
  const parsed = JSON.parse(raw) as Partial<ReceiptFile>;
  if (parsed.version !== 1) throw new Error('receipt file version must be 1');
  if (!Number.isInteger(parsed.season) || (parsed.season ?? 0) < 2018 || (parsed.season ?? 0) > 2100) {
    throw new Error('receipt season is invalid');
  }
  if (!Number.isInteger(parsed.week) || (parsed.week ?? 0) < 1 || (parsed.week ?? 0) > 18) {
    throw new Error('receipt week is invalid');
  }
  if (!parsed.observed_at || Number.isNaN(Date.parse(parsed.observed_at))) {
    throw new Error('receipt observed_at is invalid');
  }
  if (!Array.isArray(parsed.receipts) || parsed.receipts.length === 0) {
    throw new Error('receipt list is empty');
  }

  const seen = new Set<string>();
  for (const receipt of parsed.receipts) {
    const hash = String(receipt?.message_hash ?? '').trim().toLowerCase();
    const status = String(receipt?.status ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('receipt message_hash must be sha256 hex');
    if (!ALLOWED.has(status)) throw new Error(`unsupported provider status: ${status}`);
    if (seen.has(hash)) throw new Error('duplicate receipt message_hash');
    seen.add(hash);
    receipt.message_hash = hash;
    receipt.status = status;
  }

  return parsed as ReceiptFile;
}

async function main() {
  const input = process.argv[2] ?? 'ops/recap-provider-receipts.json';
  const data = parseReceiptFile(await readFile(input, 'utf8'));
  const byHash = new Map(data.receipts.map((r) => [r.message_hash, r.status]));

  const sql = connect() as unknown as {
    query<T>(text: string, params?: unknown[]): Promise<T[]>;
  };

  const rows = await sql.query<{
    id: number;
    provider_message_id: string;
    provider_status: string | null;
  }>(
    `select id, provider_message_id, provider_status
       from public.recap_deliveries
      where season = $1
        and week = $2
        and status = 'sent'
        and provider_message_id is not null
      order by id`,
    [data.season, data.week]
  );

  let matched = 0;
  let updated = 0;
  const unmatched: string[] = [];

  for (const row of rows) {
    const hash = sha256(row.provider_message_id);
    const next = byHash.get(hash);
    if (!next) {
      unmatched.push(hash.slice(0, 12));
      continue;
    }
    matched += 1;

    const current = String(row.provider_status ?? '').trim().toLowerCase();
    let effective = next;
    if (FAILED.has(current) && !FAILED.has(next)) effective = current;
    else if (DELIVERED.has(current) && !FAILED.has(next) && !DELIVERED.has(next)) effective = current;

    await sql.query(
      `update public.recap_deliveries
          set provider_status = $2,
              provider_status_checked_at = now(),
              provider_error_code = case
                when $2 = any(array['bounced','complained','failed','suppressed'])
                  then 'resend_' || $2
                else null
              end,
              updated_at = now()
        where id = $1`,
      [row.id, effective]
    );
    updated += 1;
  }

  const unknownReceipts = data.receipts.length - matched;
  console.log(
    `${data.season} week ${data.week}: ${rows.length} sent delivery row(s), ` +
    `${matched} receipt match(es), ${updated} updated, ${unmatched.length} row(s) without receipt, ` +
    `${unknownReceipts} receipt(s) without a matching delivery row.`
  );

  if (matched === 0) throw new Error('no receipt matched a stored provider message id');
  if (unmatched.length > 0) {
    console.warn(`${unmatched.length} sent row(s) still lack a provider receipt.`);
  }
}

main().catch((error) => {
  console.error(`provider receipt reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
