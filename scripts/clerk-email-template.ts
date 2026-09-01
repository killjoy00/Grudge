#!/usr/bin/env -S npx tsx

/**
 * Push the branded sign-in email in docs/clerk-signin-email.html to Clerk.
 *
 * NOT USABLE ON THE FREE PLAN. Clerk gates template editing behind
 * `app:custom_email_template`; the API answers 402 with "Unsupported plan
 * features" and the default sterile email keeps being sent. The template is
 * checked in anyway so that upgrading is one command rather than a rewrite.
 *
 *   CLERK_SECRET_KEY=sk_live_... npx tsx scripts/clerk-email-template.ts
 *
 * The key picks the instance: sk_test_ is development, sk_live_ production.
 */

import { readFileSync } from 'node:fs';

const secret = process.env.CLERK_SECRET_KEY;
if (!secret) throw new Error('CLERK_SECRET_KEY is not set.');

const SLUG = 'magic_link_sign_in';
const body = readFileSync(new URL('../docs/clerk-signin-email.html', import.meta.url), 'utf8');

// Clerk substitutes these at send time; losing one would send a link-less email.
for (const token of ['{{magic_link}}', '{{app.name}}']) {
  if (!body.includes(token)) throw new Error(`Template is missing ${token}.`);
}

const response = await fetch(`https://api.clerk.com/v1/templates/email/${SLUG}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Email link - Sign in',
    subject: 'Your Grudge sign-in link',
    body,
    delivered_by_clerk: true,
  }),
});

const text = await response.text();
if (response.ok) {
  console.log(`Updated ${SLUG}. Send yourself a sign-in link to see it.`);
} else {
  const detail = (() => {
    try {
      return (JSON.parse(text).errors ?? [])
        .map((e: { long_message?: string; message?: string }) => e.long_message ?? e.message)
        .join('; ');
    } catch { return text.slice(0, 300); }
  })();
  console.error(`Clerk refused (HTTP ${response.status}): ${detail}`);
  if (response.status === 402) {
    console.error('Custom email templates are a paid Clerk feature. Nothing was changed.');
  }
  process.exit(1);
}
