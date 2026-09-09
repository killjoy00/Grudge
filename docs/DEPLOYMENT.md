# Deployment policy

Grudge deliberately does **not** deploy to Vercel on every Git push.

`vercel.json` disables Vercel's automatic Git deployments for every branch except the single `vercel-preview` branch. Production releases are requested through `.github/workflows/deploy-vercel.yml` and the repository secret `VERCEL_DEPLOY_HOOK_URL`.

## Normal release window

The controlled deploy workflow checks once each day at **08:00 America/Chicago**. GitHub Actions' timezone-aware schedule keeps that release window fixed across daylight-saving changes.

A scheduled run compares `main` with the `vercel-deployed` marker branch. If they point to the same commit, the workflow exits without contacting Vercel. If `main` has advanced, it verifies the production schema contract before requesting a deployment.

If the exact `main` commit changed `.weekly-pipeline-request`, that commit explicitly requested a live weekly-pipeline proof. The deploy workflow waits for the push-triggered **Weekly pipeline** run on that exact SHA and refuses to contact Vercel unless the run completes successfully. Ordinary UI/code commits do not change that marker and are not forced through a production-write pipeline run.

This keeps source-control cadence separate from production-release cadence while preventing a deliberately requested live-data verification from racing a deployment.

## On-demand preview

`vercel-preview` is the only Git branch allowed to create an automatic Vercel deployment. It is deliberately kept dormant until somebody wants to inspect a change interactively.

To preview a pull request or feature without changing production, move `vercel-preview` to the commit you want to inspect. Vercel then creates one normal **Preview** deployment with its own non-production URL. Moving ordinary feature branches does nothing because `vercel.json` disables Git deployments everywhere else.

This is especially useful for ChatGPT-assisted work: after a PR passes CI, an authorized GitHub connection can point `vercel-preview` at the PR head when the user explicitly asks for a preview, inspect the resulting URL, and leave `main` untouched.

Preview deployments still count toward Vercel's deployment quota, so this lane is intentionally opt-in rather than automatic. The goal is one preview when a human actually wants to see the UI, not one preview per commit.

If the preview contains data or functionality that should not be public, enable Vercel Authentication for Preview deployments in the Vercel project's Deployment Protection settings.

## Manual release

There are two intentional manual paths:

1. Run **Controlled Vercel deploy** from the GitHub Actions tab.
2. Change `.vercel-deploy-request` on the `vercel-deploy-request` branch. This exists so an authorized automation such as ChatGPT's GitHub connection can deliberately request a production release without changing `main`. The workflow is path-scoped to that file so ordinary movement or maintenance of the control branch does not deploy anything.

Both paths use the same deploy hook and the same concurrency group, so they cannot overlap with the scheduled release. They also run the same schema, exact-commit health, and public-route smoke checks. If the exact `main` commit requested a weekly-pipeline proof, manual release paths must wait for that proof too.

## Verified production marker

`vercel-deployed` means the exact commit completed the controlled release flow: Vercel served the requested SHA, `/api/health` confirmed the required schema contract, and the representative public-route smoke suite returned HTTP 200.

The marker is advanced only after those checks pass. A failed hook, build, schema check, weekly-pipeline proof, health check, or smoke test leaves the marker unchanged so a later run can retry safely.

## Vercel connector fallback

The normal ChatGPT/Vercel connector is preferred for status, logs, and deployment inspection. If connector access is unavailable, the same safe pattern used by VotePredict can be adopted here: keep `VERCEL_TOKEN` only in GitHub Actions secrets and route narrowly scoped Vercel operations through an owner-only GitHub Actions bridge. Never put a Vercel token in repository files, issue bodies, workflow inputs, or chat.

## Why this exists

The controlled gate separates source-control cadence from production-release cadence, reduces unnecessary Vercel deployments, and makes production advancement contingent on the checks that matter for the kind of change being released.
