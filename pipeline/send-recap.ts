#!/usr/bin/env -S npx tsx
/** Send the latest completed week's recap to each configured league member. */

import { createHash } from 'node:crypto';

import { connect } from './db.ts';
import { loadRecap, type Query } from './recap-query.ts';
import { renderWeeklyRecap, type WeeklyRecap } from './recap.ts';
import { addPickupReport, loadRecapPickups } from './pickup-recap.ts';
import { makeMatchupsEmailSafe } from './email-layout.ts';
import { formatRecapPlainText } from './recap-text.ts';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_IF_EMPTY = args.includes('--skip-if-empty');
const seasonArg = args.find((arg) => arg.startsWith('--season='))?.split('=')[1];
const weekArg = args.find((arg) => arg.startsWith('--week='))?.split('=')[1];
const SEASON = Number(seasonArg ?? new Date().getUTCFullYear());

if (!Number.isInteger(SEASON) || SEASON < 2018 || SEASON > 2100) {
  throw new Error('--season must be a four-digit year.');
}

function optionalPositiveInt(value: string | undefined, name: string): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 18) {
    throw new Error(`${name} must be an integer from 1 to 18.`);
  }
  return parsed;
}

const REQUESTED_WEEK = optionalPositiveInt(weekArg, '--week');

/**
 * Send one copy to a single address instead of to the league.
 *
 * For previewing a change to the letter against real data without eleven
 * people receiving it. Deliberately does NOT touch recap_deliveries: that
 * table is the record of what the league was actually sent, and a test must
 * not be able to mark a real week as delivered (or, worse, suppress the real
 * send later because a row already says 'sent').
 *
 * The subject is prefixed so nobody mistakes it for the real thing.
 */
const TEST_RECIPIENT = args.find((a) => a.startsWith('--to='))?.split('=')[1]?.trim();
if (TEST_RECIPIENT !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(TEST_RECIPIENT)) {
  throw new Error('--to must be a single email address.');
}

interface RecapRecipient {
  profile_id: string;
  email: string;
}

class SendFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function queryClient(): Query {
  const sql = connect() as unknown as { query: Query };
  return (text, params = []) => sql.query(text, params);
}

async function loadRecipients(query: Query): Promise<RecapRecipient[]> {
  return query<RecapRecipient>(
    `select p.id as profile_id, p.email::text as email
       from public.profiles p
       join public.league_allowlist a on a.email = p.email
      where p.is_active and a.is_active and p.recap_email_enabled
      order by p.id`
  );
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to send weekly recaps.`);
  return value;
}

async function sendOne(
  apiKey: string,
  from: string,
  recipient: string,
  recap: WeeklyRecap,
  rendered: ReturnType<typeof renderWeeklyRecap>,
  /**
   * Extra idempotency salt. The real send wants Resend to swallow a duplicate
   * -- that is what protects the league from a retried workflow -- but a test
   * send has to actually arrive every time it is asked for, or the second
   * preview of a change would silently never appear.
   */
  idempotencySalt = ''
): Promise<string> {
  const recipientHash = createHash('sha256').update(recipient).digest('hex').slice(0, 16);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key':
        `grudge-recap-${recap.season}-${recap.week}-${recipientHash}${idempotencySalt}`,
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [
        { name: 'kind', value: 'weekly-recap' },
        { name: 'season', value: String(recap.season) },
        { name: 'week', value: String(recap.week) },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; name?: string };
  if (!response.ok || !payload.id) {
    // Do not print the API's free-form message: validation errors may echo the
    // recipient, and the address list is intentionally a repository secret.
    const providerName = (payload.name ?? 'unknown_error')
      .replace(/[^a-z0-9_-]+/gi, '_')
      .slice(0, 60);
    throw new SendFailure(`resend_${response.status}_${providerName}`);
  }
  return payload.id;
}

async function main() {
  const query = queryClient();
  const recap = await loadRecap(query, { season: SEASON, week: REQUESTED_WEEK });
  if (!recap) {
    // A season that has not started is a normal state for the scheduled job,
    // but a bare invocation asking for a recap that cannot exist is an error.
    if (!SKIP_IF_EMPTY) throw new Error(`${SEASON} has no completed week to recap.`);
    console.log(`${SEASON}: no completed week yet; no recap sent.`);
    return;
  }
  const siteUrl = process.env.RECAP_SITE_URL?.trim() || 'https://grudge.planitnow.us';
  const pickups = await loadRecapPickups(query, recap.season, recap.week);
  const rawRendered = addPickupReport(
    makeMatchupsEmailSafe(renderWeeklyRecap(recap, siteUrl), recap),
    pickups
  );
  const rendered = {
    ...rawRendered,
    text: formatRecapPlainText(rawRendered.text),
  };

  if (DRY_RUN) {
    console.log(rendered.subject);
    console.log(rendered.text);
    console.log('\nDry run: no email sent.');
    return;
  }

  const apiKey = required('RESEND_API_KEY');
  const from = required('RECAP_FROM_EMAIL');

  if (TEST_RECIPIENT) {
    const marked = {
      ...rendered,
      subject: `[TEST] ${rendered.subject}`,
    };
    const id = await sendOne(
      apiKey, from, TEST_RECIPIENT, recap, marked, `-test-${Date.now()}`
    );
    console.log(`${recap.season} week ${recap.week}: test copy sent (${id}).`);
    console.log('Nothing was written to recap_deliveries; the league was not emailed.');
    return;
  }

  const recipients = await loadRecipients(query);
  if (recipients.length === 0) {
    console.log(`${recap.season} week ${recap.week}: no active members opted into recaps.`);
    return;
  }

  console.log(`${recap.season} week ${recap.week}: sending ${recipients.length} private recap email(s)`);
  const failures: string[] = [];
  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i]!;
    const state = await query<{ status: string }>(
      `insert into public.recap_deliveries
         (season, week, profile_id, recipient_email, status, attempt_count,
          last_attempted_at, updated_at)
       values ($1, $2, $3, $4::citext, 'sending', 1, now(), now())
       on conflict (season, week, recipient_email) do update set
         profile_id = excluded.profile_id,
         status = case when public.recap_deliveries.status = 'sent'
                       then 'sent' else 'sending' end,
         attempt_count = case when public.recap_deliveries.status = 'sent'
                              then public.recap_deliveries.attempt_count
                              else public.recap_deliveries.attempt_count + 1 end,
         last_attempted_at = case when public.recap_deliveries.status = 'sent'
                                  then public.recap_deliveries.last_attempted_at
                                  else now() end,
         updated_at = now()
       returning status`,
      [recap.season, recap.week, recipient.profile_id, recipient.email]
    );
    if (state[0]?.status === 'sent') {
      console.log(`  skipped ${i + 1}/${recipients.length} (already sent)`);
      continue;
    }

    try {
      const id = await sendOne(apiKey, from, recipient.email, recap, rendered);
      await query(
        `update public.recap_deliveries
            set status = 'sent', provider_message_id = $4, error_code = null,
                sent_at = now(), updated_at = now()
          where season = $1 and week = $2 and recipient_email = $3::citext`,
        [recap.season, recap.week, recipient.email, id]
      );
      console.log(`  sent ${i + 1}/${recipients.length} (${id})`);
    } catch (error) {
      const code = error instanceof SendFailure ? error.code : 'unexpected_send_error';
      failures.push(code);
      await query(
        `update public.recap_deliveries
            set status = 'failed', error_code = $4,
                provider_message_id = null, updated_at = now()
          where season = $1 and week = $2 and recipient_email = $3::citext`,
        [recap.season, recap.week, recipient.email, code]
      );
      console.error(`  failed ${i + 1}/${recipients.length}`);
    }
  }
  if (failures.length) {
    throw new Error(`${failures.length} recap email(s) failed. First error: ${failures[0]}`);
  }
}

main().catch((error) => {
  console.error(`\nrecap email failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
