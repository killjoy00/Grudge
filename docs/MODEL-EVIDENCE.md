# Draft and trade model evidence — 2026.3

The trade and draft pages now read published results. They do not rebuild historical lineups or draft production on requests. Power-ranking weights remain unchanged.

## Scoring and coverage

`player_week_scores` separates a player's production from `roster_entries` ownership. Its natural key is `(season, week, player_key)`; an additional unique key prevents duplicate ESPN player-weeks. GSIS identities bridge NFL statistics and ESPN, with reviewed historical exceptions in `data/draft-player-identities.json`. `player_season_profiles` preserves season-specific positions and eligibility.

Evidence is explicit:

| Evidence | Meaning | Grade eligibility |
|---|---|---|
| observed | Archived ESPN weekly score, including an explicit zero | Eligible |
| reconstructed | NFL statistics scored under that year's archived league rules | Eligible, labeled estimate |
| verified_zero | Established NFL identity with no recorded statistics in a validated NFL week | Eligible |
| missing | No usable score or unresolved identity | Withheld |
| conflict | Ownership copies disagree about the same score | Withheld |

An absent ownership row never establishes zero production. Byes and inactive weeks are zeros only after identity and source coverage have been established. Duplicate ownership copies are classified by one shared function; their scores are never added or resolved by choosing the larger value. Fresh ESPN corrections outrank historical reconstruction. A missing new observation does not erase existing usable evidence; conflicting exact observations block grading until resolved.

The committed corpus contains **146,407 player-weeks, 2,740 offensive picks, and 19 complete seasons (2005 and 2007–2025, excluding 2020)**. Unrostered players are included. The recovered 2005 source preserves all 128 board coordinates: 119 named-player rows and nine excluded D/ST slots. ESPN itself marks eight of those blanks with the defense lineup slot; pick 126 is a reviewed manual attestation that the bench blank was a second defense. The 110 QB/RB/WR/TE selections are therefore gradeable without inventing a defense identity. The 2006 board remains withheld because 21 non-defense zero-ID slots are unresolved. All draft production ends at the Grudge regular-season boundary. Historical identities now recover early-era and injured/cut players without silently converting unknowns to zero; 2021 Irv Smith's established no-stat season remains a real zero.

The Python builder checks every regular-season week, rejects duplicate NFL weeks and conflicting ESPN scores, and fails on unresolved offensive picks. Source URLs, SHA-256 checksums, scoring comparisons, and the long-TD-bonus limitation are in `data/derived/draft-performance-provenance.json`. Raw external CSVs are cached, while compact derived evidence is committed. A manifest binds the derived files so a partial rebuild cannot be imported. The old legacy CSV remains an archived compatibility export; both historical draft commands now use canonical evidence. To refresh a cached external source after an upstream correction, remove that source file and rebuild; its checksum records the change.

## Draft model

The model allocates the league's actual offensive starting slots against the full NFL pool. Dedicated and overlapping FLEX slots determine each position's replacement boundary. Production is:

`100 × max(0, regular-season points − replacement points) / average league-starter points`

The grade subtracts historical expected production at the actual overall pick. A fixed Gaussian kernel (bandwidth 0.35) smooths log full-board pick coordinates. Kicker/defence picks remain in those coordinates but do not receive grades. The season being graded never trains its own expectation. Published retrospective comparisons use other completed seasons, including later ones; they are not preseason forecasts. A class is the average of its offensive pick values, with at least eight picks and complete season coverage required.

Every draft coordinate must be either a real player row or an explicitly evidenced excluded K/D/ST slot. Any unexplained coordinate, missing offensive identity, or missing scoring anywhere in the replacement pool or drafted-player evidence blocks the season. Excluded slots preserve their real overall-pick coordinates but receive no individual grade. A blocked publication has no current result pointer; older immutable runs remain available for audit. SQL independently verifies the known board plus excluded coordinates before exposing any class, pick, position or slot grade.

Chronological validation starts only after three prior seasons. Across **2,346 picks in 16 held-out seasons**, pick expectation had **MAE 13.4571 / RMSE 18.8845**, compared with **16.4863 / 21.6823** for a constant prior-season production expectation. The roughly 13% RMSE reduction evaluates expected normalized production, not causal drafting skill or championship prediction. Reproduce it with `npm run models:validate`; results are committed in `data/derived/draft-model-validation.json`.

## Trade model and durable records

Both trade grades credit regular-season games and only the championship bracket afterward. Excluded postseason ownership still informs the other side's counterfactual, but earns neither credit nor a replacement penalty. Missing whole roster snapshots, scoring or necessary eligibility suppress a verdict. Ungraded trades never become ties.

A ledger trade's identity comes from its transaction/proposal ID. A roster reconstruction uses the week and a hash of sorted, directed player moves. Adding another same-week trade cannot renumber an existing one. Reconciliation matches existing sequence IDs by source receipt or exact package, preserving those IDs and their ballots. Ambiguous matches fail the transaction. A disappearing detection becomes `needs_review`; it and its players/votes are retained, and it leaves the public graded ledger. Explicit retractions stay retracted.

Reviewed corrections use an existing durable ID:

```sh
npm run trade:correct -- --file=correction.json --dry-run
npm run trade:correct -- --file=correction.json
npm run models:refresh
```

A correction requires a unique `correction_id`, `season`, `trade_id`, `reason` and `action` (`correct` or `retract`). A `correct` action also requires `effective_week`, ascending `team_a`/`team_b`, and a complete `players` array of `{espn_player_id, from_team_id, to_team_id}`. The database stores the original record/package and the new correction. Reusing an audit ID for different content fails. Rebuilds preserve corrected values. Correction closes new voting, preserves existing ballots, and invalidates the old published grade through the revision hash.

## Publication and rollout

`model_runs` retains model version, input hash, coverage, as-of week and creation time. Draft/trade result rows are insert-only for the pipeline role. `model_publications` changes the visible generation in the same transaction that writes its results. Trade reads additionally require the current trade revision, so an old grade cannot follow a corrected package. The public app role can read these tables but cannot change scores or publications.

**Apply `scripts/migrations/2026-09-12-model-evidence.sql` as the database owner before merging/deploying this change.** The migration is additive and idempotent. The web/pipeline roles are not promoted. Then run:

```sh
npm ci
npm run models:refresh -- --dry-run
npm run models:refresh
```

The dry run validates committed identities, boards and scoring without a database. The real refresh imports canonical evidence, reconciles archived trades, restores exact postseason scores/season profiles, re-reads database scoring, gates coverage, and publishes results. The model refresh workflow runs after model/data changes reach main and also supports manual execution. Weekly processing rebuilds complete draft-season evidence and refreshes models before the existing data commit/recap stages. Database-writer workflows share the weekly concurrency group.

Each season publication is atomic, but a refresh and the whole weekly workflow remain several transactions. A failed later command leaves previous published snapshots readable; it does not erase them. Blocked draft coverage explicitly removes that season's current pointer. A rebuild that lacks a complete trade receipt marks the record for review rather than deleting it.

To inspect changes between generations, join result rows from two `run_id` values on `(season, overall_pick)` or `(season, trade_id)`, compare `result->>'value_delta'` / `fit->>'margin'` / `production->>'margin'`, then inspect their `model_runs.coverage` and `input_hash`. Retained corrections supply the original package when the trade itself changed.

## Verification

The test suite executes production migration/query/writer SQL in PostgreSQL via PGlite. It checks canonical uniqueness, source precedence, conflicts, explicit zeros, complete-board gates, tracked playoffs, missing whole rosters, existing-ID reconciliation, vote/correction retention, immutable prior results, stale-revision exclusion, and public-role write denial. The repository's separate RLS attack suite applies all migrations to native PostgreSQL in CI.

A replay of the seven modern archives grades all 31 detected trades and confirms the two corrected team-fit winners: team 4 in the 2022 week-9 deal with team 1, and team 8 in the 2024 week-6 deal with team 4. Excluded postseason scoring had reversed those verdicts.

Historical trade evidence and investigation leads are documented in `docs/LEGACY-TRADE-EVIDENCE.md`.
