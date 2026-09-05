# The league record, 2005 to now

The site now keeps one continuous league history while preserving the difference
between **authoritative season results** and **recovered ESPN evidence**.

## Source authority by era

| era | authoritative season result | recovered supporting evidence |
|---|---|---|
| 2005–2017 | commissioner spreadsheet transcription: final standings and playoff finish order | ESPN weekly team scoreboards and draft recaps |
| 2018–2025 | ESPN archive | weekly player lineups, transactions, matchups, standings and recovered draft boards |
| 2026 onward | live ESPN pipeline | full current capture: scores, lineups, draft, transactions, projections and derived features |

The league did not play in 2020. ESPN created a shell season, but it contains no
real games and is excluded from played-season history.

The key rule is deliberate: **recovering an old ESPN scoreboard does not let ESPN
silently rewrite a commissioner-recorded champion or final finish.** For
2005–2017, the spreadsheet still decides the season result; ESPN supplies the
week-by-week receipts behind it.

## What was recovered before 2018

Authenticated ESPN `leagueHistory` responses expose much more than the original
history implementation assumed:

- every team-vs-team weekly score back to 2005;
- the postseason matchup ledger;
- historical team names and stable ESPN team slots;
- draft recap boards back to 2005.

The recovery also established the limits:

- **transactions:** every scoring period in 2005–2017 was queried and ESPN
  returned zero transaction rows;
- **player-level weekly lineups:** legacy `mBoxscore` responses return matchup
  shells but no roster entries, so individual player weeks, optimal lineups and
  points-left-on-bench cannot be reconstructed before 2018.

Those limits are shown in the archive coverage reference rather than hidden in
code.

## Score-derived history

The recovered weekly team scores are enough to run the same score-only analytics
used today. `npm run history:scores` rebuilds, for 2005–2017:

- `team_week_results` (record, PF/PA, median and all-play fields; lineup fields
  remain null);
- `luck_index`;
- `power_rankings`;
- score-only `weekly_awards`: high scorer, low scorer, biggest blowout and
  nailbiter. `worst_bench` remains absent because it requires player lineups.

Power rankings use **the exact current formula in every season**:

- 40% all-play win percentage;
- 30% points per game, scaled to that season's best offense;
- 20% actual win percentage;
- 10% strength of schedule, measured from opponents' all-play strength.

The retired 70/30 archive-only fallback is no longer used by the site. Weekly
team scores and opponents make all four current inputs available back to 2005.

## Franchise identity

A franchise is the durable slot, not a team name and not a manager. Historical
names and manager tenures attach to that permanent franchise record.

`data/manual-history/espn-franchises.csv` is the canonical season-aware ESPN
team-id ledger. Most ids are stable for the league's entire history. One verified
exception is encoded explicitly:

- the franchise now known as CTE Deniers was ESPN team **7 in 2005**;
- the same durable franchise is ESPN team **10 from 2006 onward**.

The normal history importer now reapplies this mapping on every refresh. That is
important because the commissioner season-result CSV intentionally remains about
standings/finish; identity enrichment happens during import and can no longer be
lost on the next Tuesday rebuild.

Current durable mappings:

| franchise | ESPN id / span |
|---|---|
| Bubbs | 1, 2005– |
| Run and Hide | 2, 2005– |
| Your Worst Nightmares | 3, 2005– |
| The Penguins | 4, 2005– |
| The Penthouse Panda Bear | 5, 2005– |
| P RIVERS NAS NAS | 6, 2005– |
| Brightleaf Yuppies | 8, 2005– |
| Raleigh Silly Nannies | 9, 2006– |
| CTE Deniers lineage | 7 in 2005; 10 from 2006– |
| Taco MacArthur lineage | 11, 2006– |

## Files and refresh flow

| file | purpose |
|---|---|
| `data/manual-history/standings-2005-2017.csv` | commissioner standings transcription; edit this if an early season result is wrong |
| `data/manual-history/manager-tenures.csv` | pre-2018 manager tenure ledger |
| `data/manual-history/franchises.csv`, `managers.csv` | durable franchise/person directories |
| `data/manual-history/espn-franchises.csv` | season-aware ESPN team id → durable franchise mapping |
| `data/manual-history/espn-managers.csv` | ESPN account (SWID) → credited manager |
| `data/manual-history/season-results.csv` | generated season result ledger |
| `data/manual-history/manager-seasons.csv` | generated manager assignments |
| `data/history/<season>/` | checked-in raw historical ESPN evidence |
| `data/seasons/<season>/` | current/live season captures |

`npm run history:refresh` derives the generated history files and imports them.
The importer also applies `espn-franchises.csv`, so historical franchise ids are
present in the database even though the commissioner standings source itself does
not need to know ESPN ids.

The weekly pipeline runs `history:refresh` every Tuesday. Once a season finishes,
it joins the permanent record automatically.

## What each history surface owns

There is **one user-facing History destination** in the global navigation.
Everything else hangs from that hub instead of presenting four parallel history
tabs:

- **`/history` — hub, directory and timeline.** Seasons, permanent franchises,
  managers and champions live here. It links into the two genuinely distinct
  deep-dive views below.
- **`/history/records` — record book.** Best seasons, offenses, team-game marks,
  individual player weeks where available, final power champions and schedule
  luck extremes.
- **`/history/rivalries` — head-to-head book.** Every durable franchise pairing,
  playoff series, superlatives and full game ledgers back to 2005.
- **`/history/vault` — supporting reference, not a peer navigation tab.** Coverage
  matrix and raw season source material: scoreboards, drafts and transactions.
  It is linked from the History hub and individual season files when source
  provenance matters.
- **`/history/<season>` — season file.** The bridge between the commissioner
  result, recovered weekly evidence, standings, power ranking and source data.
- **franchise pages — permanent slot record.** Manager eras, renames, titles,
  season metrics, weekly receipts and rivalries.
- **manager pages — person record.** Career totals across franchise changes,
  regular-season crowns, season metrics and weekly receipts.

## Draft-board recovery, 2018–2025

The historical 2018–2025 archive was originally captured without
`mDraftDetail`. On September 5, 2026, a targeted authenticated repair fetched
only that ESPN view and merged it into the existing archives without replacing
matchups, standings, rosters or transactions.

The repair added 1,150 draft picks across the seven played seasons in that span:
2018, 2019 and 2021 each have 170 picks; 2022–2025 each have 160. Those boards are
now imported into production and the artificial Vault gap is closed.

## Playoff reconstruction before 2018

The commissioner spreadsheet records final finish but not an explicit bracket.
`lib/playoff-bracket.ts` derives playoff W-L from the league's six-team bracket:
seeds 1–2 receive byes; 3v6 and 4v5 play the first round; then semifinals and the
championship. The derivation throws if the recorded finish order cannot fit the
bracket rather than inventing a result.

2006 is the one documented seeding exception: Boston Baked Beans went 9–4 but
lost in the first round, which is only consistent with divisional byes. The
Penguins and Your Worst Nightmares are therefore the recorded bye teams for that
season. This exception remains isolated in `SEASON_BYES`.

Recovered ESPN postseason scoreboards now provide a second evidence layer for
those old seasons, while the commissioner finish remains authoritative.

## Manager identity

Manager records follow people rather than ESPN account labels. Historical aliases
are normalized in `managers.csv`; co-owned teams are credited only to the manager
the league recognizes. ESPN accounts intentionally not credited remain listed in
`espn-managers.csv` with a blank `manager_key`, so they are known rather than
mistaken for missing data.

Every franchise-season has one primary credited manager. Manager career pages can
therefore follow a person across franchise changes without rewriting the franchise
record itself.
