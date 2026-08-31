# Step 1 — ESPN v3 API exploration findings

League **114052** ("UNC Grudge Match"), season **2026**. All requests unauthenticated.
Regenerate everything with `node exploration/explore.mjs`.

Everything below was read out of the payloads in `exploration/raw/`. Where I could
*not* confirm something from live data, it is called out under
[Where I am still guessing](#where-i-am-still-guessing) — nothing from that section
should be treated as known.

---

## 0. The single most important context: the season has not started

```
status.currentMatchupPeriod = 1
status.latestScoringPeriod  = 1
draftDetail.drafted         = true
```

Every team has `points: 0`, `record.overall.wins: 0`, and all 70 matchups have
`winner: "UNDECIDED"`. The draft has happened (2026-04-27 per `draftSettings.date`),
first kickoff is **2026-09-09 20:20 ET**.

Consequences that shape every later step:

- I have confirmed the **shape** of scoring/roster/matchup payloads, but every
  numeric value in them is currently zero. I have not seen a single populated
  box score, a real `winner`, or a completed week.
- `mTransactions2` contains **only draft picks**. I have not observed a single
  `ADD`, `DROP`, `TRADE`, or `WAIVER` transaction for this league.
- The playoff bracket does not exist yet (see §4).

## 1. Views: what each one actually returns

| Request | HTTP | Size | Adds |
|---|---|---|---|
| `?view=mTeam` | 200 | 39 KB | `members[]`, `teams[]` (identity, record, `transactionCounter`, `valuesByStat`) |
| `?view=mRoster` | 200 | 1.1 MB | `teams[].roster.entries[]` with full `player` objects |
| `?view=mMatchup` | 200 | 533 KB | `schedule[]` + `teams[]` |
| `?view=mMatchupScore` | 200 | 231 KB | `schedule[]` only, but **richer per-side fields** than `mMatchup` |
| `?view=mStandings` | 200 | 14 KB | `teams[]` reduced to `{id, playoffClinchType, currentSimulationResults}` |
| `?view=mSettings` | 200 | 7.5 KB | `settings` (schedule/roster/scoring/acquisition/draft) |
| `?view=mTransactions2` | 200 | 68 KB | `transactions[]` |
| `?view=mBoxscore&scoringPeriodId=N` | 200 | 243 KB | **per-player weekly points** — the view we actually need |
| `?view=kona_player_info` + `X-Fantasy-Filter` | 200 | 147 KB | free-agent pool w/ ownership |
| `/seasons/2026?view=proTeamSchedules_wl` | 200 | 109 KB | **NFL kickoff timestamps** |

Notes confirmed by diffing the dumps:

- `scoringPeriodId` in the query string is **ignored** by `mMatchup`, `mRoster`, and
  `mTransactions2` — byte-identical responses with and without it. It *does* matter
  for `mBoxscore`.
- Multiple `view=` params in one request work and merge (`multiview` returned 1.4 MB
  with the union of top-level keys). One combined request per week is viable.
- `mStandings` is **not** a standings table. It is ESPN's own Monte Carlo output:
  `currentSimulationResults.{playoffPct, divisionWinPct, rank, modeRecord}`. Real
  standings come from `mTeam.teams[].record.overall`.
- `mMatchupScore` is the better matchup view. Only it carries `playoffTierType`,
  `pointsByScoringPeriod`, `totalPointsLive`, `totalProjectedPoints`, `winProbability`,
  `adjustment`, `tiebreak`. `mMatchup` has none of those.

## 2. Teams ↔ member SWIDs (one of the three flagged areas)

**There is no 1:1 mapping, and team IDs are not contiguous.**

- 10 teams, IDs **1, 2, 3, 4, 5, 6, 8, 9, 10, 11** — there is **no team 7**.
  Never index teams by position or assume `1..size`.
- **13 members for 10 teams.** Three teams have two owners:

  | Team | Name | `primaryOwner` | co-owner |
  |---|---|---|---|
  | 1 | Austin Bubbs | Killjoy00 (Ryan Mindell) | lafleur_81 (byron lafleur) |
  | 5 | The Penthouse Panda Bear | TWildfir (Ben Wildfire) | lidboy (Jeremy Wildfire) |
  | 10 | CTE Deniers | DownThat40 (Jordan Chin) | ncstatered (Jason Campbell) |

- `members[].id` is the SWID, formatted **with literal braces**:
  `{164FA15F-6CCC-4240-8ED4-940DC77B6F1A}`. Store it verbatim; do not strip braces.
- The join is `teams[].owners[]` (array of SWIDs) → `members[].id`.
  `teams[].primaryOwner` is a single SWID and is always present in `owners[]`.
- Every member maps to exactly one team, so **member → team is many-to-one**.
  A `profiles` table cannot carry a unique constraint on `espn_team_id`.
- `members[]` carries `displayName`, `firstName`, `lastName` — but **no email address**.
  The Step 5 allowlist cannot be derived from the API; you have to supply it, and I
  will need a manual SWID↔email mapping.
- `members[].isLeagueManager` is absent (`None`) on every member — it does not
  identify the commissioner here. `is_admin` has to be set by us.

## 3. Roster slots: starter vs. bench (second flagged area)

`settings.rosterSettings.lineupSlotCounts` is authoritative for *how many* of each
slot. To learn what each slot *means* I did not rely on any remembered ID table —
I inverted every player's `eligibleSlots` across 185 players and read off which
`defaultPositionId`s can occupy each slot.

`defaultPositionId`, identified by the player names in the payload:

| id | position | evidence from payload |
|---|---|---|
| 1 | QB | Lamar Jackson, Joe Burrow, Jayden Daniels |
| 2 | RB | James Cook III, David Montgomery |
| 3 | WR | Amon-Ra St. Brown, Chris Olave |
| 4 | TE | Travis Kelce, Sam LaPorta |
| 5 | K | Harrison Butker, Cameron Dicker |
| 16 | D/ST | Rams D/ST, Ravens D/ST |

`lineupSlotId` → eligible positions (derived), with this league's counts:

| slot | count | eligible positions | role |
|---|---|---|---|
| 0 | 1 | QB | starter |
| 2 | 2 | RB | starter |
| 4 | 2 | WR | starter |
| 5 | 1 | WR, TE | starter (WR/TE) |
| 6 | 1 | TE | starter |
| 16 | 1 | D/ST | starter |
| 17 | 1 | K | starter |
| 23 | 1 | RB, WR, TE | starter (FLEX) |
| 20 | 6 | all | **bench** |
| 21 | 2 | all | **IR** |
| 3, 7, 12, 14, 15, 25 | 0 | — | offered by ESPN, unused by this league |

**The rule to encode: a slot is a starter iff `lineupSlotCounts[slot] > 0` and
slot ∉ {20, 21}.** Do not hardcode a starter list — derive it from settings so a
settings change doesn't silently corrupt the optimal-lineup math.

Live roster check: 160 entries = 16 per team (10 starters + 6 bench), 0 on IR.

Per-entry fields: `playerId`, `lineupSlotId`, `acquisitionType` (`DRAFT` today),
`acquisitionDate` (epoch ms), `injuryStatus`, `status`, `pendingTransactionIds`,
and a nested `playerPoolEntry.player`.

**For optimal-vs-actual lineup**, `mBoxscore&scoringPeriodId=N` →
`schedule[].{home,away}.rosterForCurrentScoringPeriod.entries[]` gives 16 entries
each with `lineupSlotId` + `playerPoolEntry.appliedStatTotal`. That is exactly the
(slot, player, points) triple the feature needs. Confirmed present and populated
structurally; values are 0 because no game has been played.
`rosterForMatchupPeriod.entries` is **empty** — use `rosterForCurrentScoringPeriod`.

## 4. Schedule and playoffs

- `schedule[]` has **70 entries = 14 periods × 5 matchups**. Matches your stated
  14-week regular season.
- **Playoff matchups (periods 15–17) do not exist yet.** `playoffTierType` is `null`
  on all 70, `winner` is `UNDECIDED` on all 70. ESPN generates the bracket later.
  The pipeline must tolerate `schedule` growing mid-season, and playoff odds must
  simulate the bracket itself rather than reading it.
- `scheduleSettings`: `matchupPeriodCount: 14`, `playoffTeamCount: 6`,
  `playoffSeedingRule: "TOTAL_POINTS_SCORED"`, `playoffMatchupPeriodLength: 1`,
  `playoffReseed: false`, one division (`id: 0`, "Tar Heel", size 10).
- `matchupPeriods` maps each matchup period 1:1 onto a single scoring period, 1→17.
  **matchupPeriodId and scoringPeriodId are interchangeable for this league**, which
  simplifies a lot — but only because `matchupPeriodLength: 1`.
- `schedule[].id` is a stable per-matchup integer; `{home,away}.teamId` are the sides.
  Zero byes (all 70 have both sides).

## 5. `mTransactions2` (third flagged area)

**What it returns today: 160 records, all `type: "DRAFT"`.** 16 rounds × 10 teams.

```json
{
  "id": "b3fb1fa7-5d72-4a14-b143-ba56732bb089",
  "type": "DRAFT", "status": "EXECUTED", "executionType": "EXECUTE",
  "isPending": false, "teamId": 10, "scoringPeriodId": 1,
  "proposedDate": 1788053973696, "bidAmount": 0, "rating": 0,
  "isActingAsTeamOwner": false, "isLeagueManager": false,
  "items": [{
    "type": "DRAFT", "playerId": 4431611,
    "fromTeamId": 0, "toTeamId": 10,
    "fromLineupSlotId": -1, "toLineupSlotId": 20,
    "isKeeper": false, "overallPickNumber": 121
  }]
}
```

Observations:

- The envelope is one transaction with an `items[]` array — so a trade will be one
  record with several items. Model it as **transaction + transaction_items**, not a
  flat table.
- `fromTeamId: 0` means "not from a team" (free agent pool / draft).
  `fromLineupSlotId: -1` means "no prior slot".
- `bidAmount` exists on the envelope and is `0` for every draft pick — that is the
  FAAB field, unexercised so far.
- `scoringPeriodId` is `1` on all 160 (the draft is attributed to week 1).
- All 10 real team IDs appear.
- `?view=mPendingTransactions` is a separate, working view (751 B, currently empty).

**I have not seen an ADD, DROP, TRADE, or WAIVER record for this league.** Their
exact `type`/`status` strings and item shapes are unverified. See below.

## 6. Free agent pool — `kona_player_info` (needed for Step 8)

Confirmed working unauthenticated with an `X-Fantasy-Filter` header:

```
X-Fantasy-Filter: {"players":{"filterStatus":{"value":["FREEAGENT","WAIVERS"]},
                   "limit":25,"sortPercOwned":{"sortAsc":false,"sortPriority":1}}}
```

Returned 25 players, all `status: "WAIVERS"`, `onTeamId: 0`, plus a
`waiverProcessDate` (epoch ms). Ownership trend fields are present per player:

```json
"ownership": { "percentOwned": 73.4, "percentChange": 0.63, "percentStarted": 6,
               "auctionValueAverage": 1.66, "auctionValueAverageChange": 0.03,
               "averageDraftPosition": 119.56, "averageDraftPositionPercentChange": 0.83,
               "date": 1788093016550 }
```

`percentChange` is ESPN's own week-over-week delta, so the weekly snapshot table you
want gives us a second, independent trend line to cross-check against.

## 7. Player stats

`player.stats[]` entries are keyed by `(statSourceId, statSplitTypeId, scoringPeriodId, seasonId)`:

| statSourceId | statSplitTypeId | scoringPeriodId | meaning |
|---|---|---|---|
| 0 | 0 | 0 | **actual**, season total (2025 and 2026 both present) |
| 1 | 0 | 0 | **projected**, season total |
| 1 | 1 | 1 | **projected**, single week |

So `statSourceId: 0` = actual, `1` = projected. Each carries `appliedTotal`,
`appliedAverage`, `appliedStats` (statId → points) and `stats` (statId → raw).
No `(0, 1, N)` weekly-actual rows exist yet — they will appear once games are played.

`settings.scoringSettings.scoringItems` has 40 entries; 23 use `pointsOverrides`
keyed by **positionId**, meaning position-specific scoring. Flat items include
`statId 15 → 1pt` and `statId 25 → 6pt`. `scoringType: "H2H_POINTS"`,
`matchupTieRule: "SLOT_POINTS"`, `homeTeamBonus: 0`.

## 8. Kickoff times — the source for the Step 5 pick lock

`/apis/v3/games/ffl/seasons/2026?view=proTeamSchedules_wl` → 272 games with
`{id, scoringPeriodId, date (epoch ms), homeProTeamId, awayProTeamId, startTimeTBD, validForLocking}`.

First kickoff per scoring period (UTC):

| SP | first kickoff | SP | first kickoff |
|---|---|---|---|
| 1 | Thu 2026-09-10 00:20Z | 10 | Fri 2026-11-13 01:15Z |
| 2 | Fri 2026-09-18 00:15Z | 11 | Fri 2026-11-20 01:15Z |
| 3 | Fri 2026-09-25 00:15Z | 12 | Thu 2026-11-26 01:00Z |
| 4 | Fri 2026-10-02 00:15Z | 13 | Fri 2026-12-04 01:15Z |
| 5 | Fri 2026-10-09 00:15Z | 14 | Fri 2026-12-11 01:15Z |
| 6 | Fri 2026-10-16 00:15Z | 15 | Fri 2026-12-18 01:15Z |
| 7 | Fri 2026-10-23 00:15Z | 16 | Fri 2026-12-25 01:15Z |
| 8 | Fri 2026-10-30 00:15Z | 17 | Fri 2027-01-01 01:15Z |
| 9 | Fri 2026-11-06 01:15Z | | |

This is a real, machine-readable lock time per week — good news for enforcing the
lock in the database rather than the UI. Two caveats:

- SP16 and SP17 each have 4 games with `startTimeTBD: true` and
  `validForLocking: false` (NFL flex scheduling). Those weeks' first kickoff can
  still move. The lock time must be **re-read every week**, not computed once.
- SP1's first game reads NE@SEA at **Wed 2026-09-09 20:20 ET**, a day earlier than
  the usual Thursday opener. It may be a placeholder. Worth re-checking in September.

## 9. League history — the check you asked for before I build rivalry records

**Cross-season head-to-head is not buildable from the public API.** Details:

- `/leagueHistory/114052?seasonId={YEAR}` returns **404 for every year 2012–2026**,
  and 404 without `seasonId` too. This endpoint is dead for this league.
- Going directly at `/seasons/{YEAR}/segments/0/leagues/114052`:

  | seasons | response |
  |---|---|
  | ≤ 2016 | 404 Not Found |
  | **2018 – 2025** | **401 `AUTH_LEAGUE_NOT_VISIBLE`** |
  | 2026 | 200 OK |
  | 2027 | 404 Not Found |

- Control: a nonexistent league ID returns **404** in those same years, not 401.

The 401-vs-404 split is the finding. It means **the league genuinely existed in
2018–2025, but those seasons are not publicly readable** — 2026 was made public,
prior years were not. So the data exists on ESPN's side and is reachable only with
your logged-in `SWID` + `espn_s2` cookies.

**My recommendation: cut cross-season rivalry records from Step 4 scope** and
revisit as an optional backfill. If you want it, the path is: you log into ESPN,
pull both cookies from the browser, and we do a **one-time** authenticated backfill
of 2018–2025 into `/data`, committed as history. That keeps the weekly pipeline
unauthenticated and public, with the cookies never stored in CI. Your call — I have
not built anything toward this either way.

**Update, post-backfill:** the above was executed. `scripts/backfill-history.mjs`
captured all 8 seasons (2018–2025) into `data/history/`, authenticated. Two things
worth recording that weren't knowable before real data existed:

- **ESPN reuses team IDs consistently for this league.** All 10 `espn_team_id`s map
  to the same franchise name and the same `primaryOwner` SWID across every season
  2018–2025 and the live 2026 season. `head_to_head` can safely join on
  `espn_team_id` — no fallback to owner-SWID needed, resolving the open question
  in `docs/SCHEMA_PROPOSAL.md`.
- **Pre-2018 seasons are unreachable even authenticated.** The 2020 payload's
  `status.previousSeasons` field lists `[2005..2019]`, suggesting 21 seasons of
  history — but probing `/seasons/{2005,2008,2011,2014,2016,2017}/.../114052`
  with valid owner cookies returned **404 for all of them**, the same as
  unauthenticated. `previousSeasons` looks like a stale/carried-over marker on
  ESPN's side, not a working index. **2018 is the real floor**; there is no
  further history to recover from this API, authenticated or not.
- **Confirmed by the league admin: the league did not play a 2020 season** —
  explains the empty-shell payload (`currentMatchupPeriod: 1`,
  `latestScoringPeriod: 0`, every record and score at zero, all matchups
  `UNDECIDED`). This isn't a capture bug or a request-shape problem; ESPN kept
  the league's 2020 slot allocated but nothing was ever played into it. Data is
  captured as-is for completeness. `season = 2020` should simply be excluded
  from standings, head-to-head, and any weekly feature — no fix needed, since
  there's nothing to fix.

---

## Where I am still guessing

Flagged per your instruction. Nothing here is confirmed by Step 1 output:

1. **Non-draft transaction shapes.** Only `DRAFT` exists today. The `type` values for
   adds/drops/trades/waivers, the `status` values for failed waiver claims, and
   whether `bidAmount` is populated for FAAB claims are all **unverified**. I will
   write the transaction ingest to store the **raw JSON envelope** alongside the
   normalized columns, so the first real transaction of the season tells us the truth
   without a re-fetch or a lost record.
2. **Whether `mTransactions2` returns full-season history or a rolling window.** It
   ignored `scoringPeriodId` and returned all 160 draft picks, but a league with
   hundreds of in-season moves may paginate or truncate. Unknowable until moves exist.
   Mitigation: `/data` keeps every weekly raw snapshot, so we accumulate history even
   if a single call later stops returning it.
3. **Weekly actual stat rows** (`statSourceId: 0` with a nonzero `scoringPeriodId`).
   Their existence is inferred from the projected-weekly rows' shape, not observed.
4. **`acquisitionSettings` is internally inconsistent**: `acquisitionType:
   "WAIVERS_TRADITIONAL"` and `waiverOrderReset: true` and per-team `waiverRank`
   (a rolling-list league), but also `isUsingAcquisitionBudget: true` with
   `acquisitionBudget: 100` (a FAAB league), and `waiverProcessDays: []` (empty)
   with `waiverProcessHour: 3` and `waiverHours: 48`. **Which one is live matters for
   the Step 8 waiver analysis.** Can you confirm in the ESPN UI whether the league
   runs FAAB bidding or waiver priority order?
5. **`positionLimits`** caps positionId 5 (K) and 16 (D/ST) at 3 each and sets
   most others to `-1` (unlimited); `0` appears for positions the league disallows.
   The `-1`/`0` semantics are inferred from context, not documented.
6. **Playoff bracket seeding mechanics.** `playoffSeedingRule: "TOTAL_POINTS_SCORED"`
   with `playoffReseed: false` and 6 of 10 teams — the standard reading is 2 byes and
   a 3v6/4v5 first round, but the bracket isn't in the payload, so Step 4's Monte
   Carlo will state its bracket assumption explicitly in comments.
