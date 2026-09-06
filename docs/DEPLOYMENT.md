# Deployment policy

Grudge deliberately does **not** deploy to Vercel on every Git push.

`vercel.json` disables Vercel's automatic Git deployments for every branch except the single `vercel-preview` branch. Production releases are requested through `.github/workflows/deploy-vercel.yml` and the repository secret `VERCEL_DEPLOY_HOOK_URL`.

## Normal release window

The controlled deploy workflow checks once each day at **08:00 America/Chicago**. GitHub Actions' timezone-aware schedule keeps that release window fixed across daylight-saving changes.

A scheduled run compares `main` with the `vercel-deployed` marker branch. If they point to the same commit, the workflow exits without contacting Vercel. If `main` has advanced, it calls the production deploy hook once and moves `vercel-deployed` to that SHA after Vercel accepts the hook request.

This means normal coding, pull requests, merges, and the Tuesday data pipeline can create as many Git commits as needed without consuming Vercel deployment quota. At most one changed `main` is sent to Vercel in the daily release window.

## On-demand preview

`vercel-preview` is the only Git branch allowed to create an automatic Vercel deployment. It is deliberately kept dormant until somebody wants to inspect a change interactively.

To preview a pull request or feature without changing production, move `vercel-preview` to the commit you want to inspect. Vercel then creates one normal **Preview** deployment with its own non-production URL. Moving ordinary feature branches does nothing because `vercel.json` disables Git deployments everywhere else.

This is especially useful for ChatGPT-assisted work: after a PR passes CI, an authorized GitHub connection can point `vercel-preview` at the PR head when the user explicitly asks for a preview, inspect the resulting URL, and leave `main` untouched.

Preview deployments still count toward Vercel's deployment quota, so this lane is intentionally opt-in rather than automatic. The goal is one preview when a human actually wants to see the UI, not one preview per commit.

If the preview contains data or functionality that should not be public, enable Vercel Authentication for Preview deployments in the Vercel project's Deployment Protection settings.

## Manual release

There are two intentional manual paths:

1. Run **Controlled Vercel deploy** from the GitHub Actions tab. Manual runs always call Vercel, even when `main` matches the marker.
2. Change `.vercel-deploy-request` on the `vercel-deploy-request` branch. This exists so an authorized automation such as ChatGPT's GitHub connection can deliberately request a production release without changing `main`. The workflow is path-scoped to that file so ordinary movement or maintenance of the control branch does not deploy anything.

Both paths use the same deploy hook and the same concurrency group, so they cannot overlap with the scheduled release.

## Marker semantics

`vercel-deployed` means "Vercel accepted a deploy-hook request for this SHA." It does not prove that the subsequent Vercel build reached `READY`. Build status should still be checked after an important manual production release.

If the deploy hook itself fails or is rate-limited before returning a successful HTTP response, the marker is not advanced. The next scheduled run will retry the same `main` SHA.

## Why this exists

The Vercel Hobby deployment quota can be exhausted by a burst of otherwise harmless Git activity. The controlled gate separates source-control cadence from production-release cadence: GitHub can stay active, while Vercel is contacted only at the daily release window, through the one opt-in preview branch, or after an explicit manual production request.
