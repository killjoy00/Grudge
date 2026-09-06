# Deployment policy

Grudge deliberately does **not** deploy to Vercel on every Git push.

`vercel.json` disables Vercel's automatic Git deployments for every branch. Production releases are requested through `.github/workflows/deploy-vercel.yml` and the repository secret `VERCEL_DEPLOY_HOOK_URL`.

## Normal release window

The controlled deploy workflow checks once each day at **08:00 America/Chicago**. GitHub cron schedules are UTC-only, so the workflow is registered for both possible UTC hours and uses a timezone guard to remain fixed at 08:00 across daylight-saving changes.

A scheduled run compares `main` with the `vercel-deployed` marker branch. If they point to the same commit, the workflow exits without contacting Vercel. If `main` has advanced, it calls the production deploy hook once and moves `vercel-deployed` to that SHA after Vercel accepts the hook request.

This means normal coding, pull requests, merges, and the Tuesday data pipeline can create as many Git commits as needed without consuming Vercel deployment quota. At most one changed `main` is sent to Vercel in the daily release window.

## Manual release

There are two intentional manual paths:

1. Run **Controlled Vercel deploy** from the GitHub Actions tab. Manual runs always call Vercel, even when `main` matches the marker.
2. Push or advance the `vercel-deploy-request` branch. This exists so an authorized automation such as ChatGPT's GitHub connection can deliberately request a production release without changing `main`.

Both paths use the same deploy hook and the same concurrency group, so they cannot overlap with the scheduled release.

## Marker semantics

`vercel-deployed` means "Vercel accepted a deploy-hook request for this SHA." It does not prove that the subsequent Vercel build reached `READY`. Build status should still be checked after an important manual production release.

If the deploy hook itself fails or is rate-limited before returning a successful HTTP response, the marker is not advanced. The next scheduled run will retry the same `main` SHA.

## Why this exists

The Vercel Hobby deployment quota can be exhausted by a burst of otherwise harmless Git activity. The controlled gate separates source-control cadence from production-release cadence: GitHub can stay active, while Vercel is contacted only at the daily release window or after an explicit manual request.
