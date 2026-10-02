# Recap provider reconciliation bridge

This branch is an operational fallback for Grudge recap delivery verification.

## Why it exists

GitHub Actions has the `app_pipeline` Neon credential. That role can update
`public.recap_deliveries` and bypass RLS, but it cannot create tables,
functions, or otherwise change the schema. The database-owner URL is
intentionally not stored in GitHub Actions.

The preferred long-term path remains the signed Resend webhook implemented on
`main`. It requires the owner migration
`scripts/migrations/2026-10-01-recap-provider-webhook.sql`.

Until that owner migration can be applied, this branch keeps mailbox-level
monitoring accurate without broadening the send-only Resend API key.

## Privacy model

`ops/recap-provider-receipts.json` contains only:

- SHA-256 hashes of Resend email IDs
- normalized lifecycle states such as `delivered` or `bounced`
- season, week, and observation time

It must never contain recipient addresses, raw provider IDs, email content,
API keys, signing secrets, or other personal data.

The workflow hashes the provider IDs already stored in Neon, joins only on
those hashes, and updates only the provider-status fields on existing
`recap_deliveries` rows. It then runs the same provider verification used by
the normal recap watchdog.

A scheduled ChatGPT condition watch refreshes this receipt file on Tuesday
afternoons using the connected Resend account. Normal successful checks stay
silent; terminal delivery failures or reconciliation problems surface to the
user.
