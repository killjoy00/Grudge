# Grudge

Grudge is the private web companion for a long-running fantasy football league. It combines the live ESPN league, recovered history back to 2005, predictions, weekly recaps, player and trade ledgers, manager-vs-manager Grudges, and versioned draft/trade models.

Production: `https://grudge.planitnow.us`

## What the site owns

- **Current season:** scoreboard, standings, rankings, playoff odds, predictions, transactions and the League Wire.
- **My Grudge:** signed-in manager dashboard and current matchup context.
- **History:** seasons, franchises, managers, Team Records, Draft History, Grudges and source coverage.
- **Players:** NFL production, Grudge scoring, player profiles, career records and transaction/ownership history where evidence exists.
- **Trades:** durable trade ledger, voting, team-fit grades and player-production grades.
- **Recaps:** current-week homepage story plus the historical recap archive and optional weekly email.

## Evidence boundaries

Grudge distinguishes authoritative league results from recovered supporting evidence.

| Era | Authority and coverage |
| --- | --- |
| 2005–2017 | Commissioner records decide final season results. ESPN supplies recovered weekly team scoreboards and draft boards. Historical player lineups and transaction ledgers are not available. |
| 2018–2025 | ESPN archive supplies standings, weekly player lineups, transactions, matchups and recovered draft boards. |
| 2026 onward | Live ESPN pipeline captures the current league and maintains derived data. |

The league did not play in 2020. Draft performance grades cover 2005 and 2007–2025. The 2005 source preserves all 128 draft coordinates: 119 named player rows plus nine excluded D/ST slots, eight identified by ESPN's defense lineup slot and one manually reviewed as a second defense. The 2006 board remains source history only because 21 non-defense zero-ID slots are still unresolved. Never invent data to fill an evidence gap. See `docs/LEAGUE-HISTORY.md`, `docs/HISTORICAL-TRANSACTIONS.md` and `docs/LEGACY-TRADE-EVIDENCE.md` before changing historical behavior.

## Identity rules

These are architectural contracts, not implementation details.

- `franchise_key` is the durable fantasy-franchise identity. A team name or ESPN team ID is not a franchise identity.
- `franchise_season_teams` maps a durable franchise into a season. `franchise_season_results` contains settled season outcomes separately.
- `manager_key` identifies a person. Grudges are manager-vs-manager and follow a person across franchise changes.
- `nfl_players.player_key` is the canonical player identity outside raw provider ingestion.
- ESPN player IDs are season-scoped evidence aliases through `nfl_player_aliases`; do not assume an early ESPN ID is globally durable.
- Provider evidence may enrich a canonical record. It must not silently redefine identity.

Read `docs/DATA-MODEL.md` before changing any identity mapping or historical join.

## Models

Draft and trade grades are published, versioned results. Web requests read the published generation; they do not rebuild models on demand.

The current draft model evaluates regular-season production above replacement against historical expected production at the actual overall pick. Kicker and D/ST selections remain in draft-board coordinates but are not individually graded. Trade pages preserve separate team-fit and player-production views because they answer different questions.

Rules for model work:

1. Do not change a grading formula casually or to make one displayed result look better.
2. Reproduce and validate a model change against historical evidence before adopting it.
3. Bump the model version when model semantics change.
4. Keep display formatting out of ordering/math. Numeric results must be sorted as numeric values, not formatted text.
5. A season with incomplete board, identity or scoring evidence must be blocked rather than partially graded.

See `docs/MODEL-EVIDENCE.md` and `docs/MODEL-AUDIT.md`.

## Operations

The web app is intentionally usable from a phone. Admins can use:

- `/admin/status` — production SHA, schema contract, ESPN/current-week freshness, NFL player refresh, model publications, recap status and GitHub workflow health.
- `/admin` — membership and ownership-capture overview.
- `/admin/members` — league access and team assignment.
- `/admin/recaps` — recap delivery history.
- `/admin/trades` — trade administration.

### Production releases

Normal Git pushes do **not** deploy directly to production. Vercel Git auto-deploy is deliberately disabled.

`.github/workflows/deploy-vercel.yml` is the release authority. It can run in the scheduled release window or from an explicit deploy request. A successful release must verify the production schema, serve the exact requested commit, pass `/api/health`, smoke-test representative public routes, and only then advance the `vercel-deployed` marker branch.

`vercel-deployed` therefore means **verified live**, not merely “a Vercel hook was called.” See `docs/DEPLOYMENT.md` before changing release behavior.

### Recurring data jobs

- `.github/workflows/weekly.yml` — live ESPN capture, derived features, predictions, history refresh, ownership capture, model refresh, raw-data commit and optional recap.
- `.github/workflows/refresh-players.yml` — current/prior NFL player-ledger refresh.
- `.github/workflows/refresh-model-results.yml` — rebuild/publish model evidence after model-related changes.
- `.github/workflows/ci.yml` — dependency audit, TypeScript, tests, production build, RLS attack suite, player browser checks and live admin gating.

The weekly and player/model writers share deployment/database safety controls. Do not bypass those workflows with ad-hoc production writes.

## Development checks

Use Node 22. Before merging application changes, the normal baseline is:

```sh
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run players:import -- --dry-run
npm run build
```

Useful targeted checks:

```sh
npm run schema:verify
npm run models:validate
npm run models:build-data
npm run models:refresh -- --dry-run
npm run history:refresh
```

Production database migrations must follow the migration/release process in `docs/DEPLOYMENT.md`; never grant the web app the pipeline role or `BYPASSRLS`.

## Rules for future coding agents

Before making a broad change, identify which data source and identity layer owns the fact being changed. In particular:

- Do not infer pre-2018 trades, weekly ownership or player starts from draft and final-roster endpoints.
- Do not let recovered ESPN data overwrite commissioner-authoritative 2005–2017 champions/final finishes.
- After the Grudge regular season, only explicit winners-bracket playoff games count in Grudge competitive records. Consolation/placement games remain source evidence but not tracked games.
- Do not reintroduce franchise-vs-franchise rivalry identity; Grudges are manager-vs-manager.
- Do not use ESPN player IDs as durable application player keys.
- Do not merge a current-season identity mapping with a settled season result simply because both mention the same franchise.
- Do not expose pipeline credentials to the Next.js application. User/admin reads must remain behind the existing Clerk + PostgreSQL RLS model.
- Do not treat a merged GitHub commit as deployed. Verify the exact production SHA through the controlled release flow.
- Surface uncertainty and source gaps in the UI instead of manufacturing complete-looking data.

## Documentation map

- `docs/DATA-MODEL.md` — canonical franchise, manager and player identities.
- `docs/LEAGUE-HISTORY.md` — authority by era and historical reconstruction rules.
- `docs/MODEL-EVIDENCE.md` — draft/trade model inputs, publication and evidence policy.
- `docs/MODEL-AUDIT.md` — validation of ranking and grading choices.
- `docs/PLAYER-LEDGER.md` — NFL player data, Grudge scoring and profile coverage.
- `docs/DEPLOYMENT.md` — controlled Vercel production process.
- `docs/WEEKLY-RECAPS.md` — recap product and delivery behavior.
- `docs/HISTORICAL-TRANSACTIONS.md` — 2018–2025 ESPN transaction repair.
- `docs/LEGACY-TRADE-EVIDENCE.md` — what can and cannot be established before 2018.
- `docs/SETUP.md` — environment and setup details.

When those documents conflict with an old comment or exploration file, prefer the current canonical data-model, evidence and deployment documents and verify the live schema before changing behavior.
