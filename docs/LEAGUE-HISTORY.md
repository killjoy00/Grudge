# The league record, 2005 to now

Twenty played seasons in one table, from two sources that agree on nothing but
the franchises:

| era | source | what it gives |
|---|---|---|
| 2005-2017 | the commissioner's spreadsheet, transcribed | final standings and a playoff finish order |
| 2018- | `data/history/<year>/league.json.gz` | ESPN's own records, brackets, placements, and owner accounts |

ESPN's API returns 404 for this league before 2018 even with owner cookies, so
the early years can only come from human records. The league did not play in
2020; ESPN created the season and it sits in the archive with every team 0-0,
so the derivation skips it by name.

## Files

| file | what it is |
|---|---|
| `data/manual-history/standings-2005-2017.csv` | Transcription of the spreadsheet, in finish order. **Edit this** if a number is wrong. |
| `data/manual-history/manager-tenures.csv` | The 2005-2017 ownership ledger, as joined/left ranges. |
| `data/manual-history/franchises.csv`, `managers.csv` | The ten franchises and everyone who has run one. |
| `data/manual-history/espn-franchises.csv` | ESPN team id → franchise. |
| `data/manual-history/espn-managers.csv` | ESPN account (SWID) → person. |
| `data/manual-history/season-results.csv` | **Generated.** Every team-season, both eras. |
| `data/manual-history/manager-seasons.csv` | **Generated.** Who ran what, every season. |

Never hand-edit the two generated files; `npm run history:derive` rebuilds them
and the test suite fails if they drift.

```bash
npm run history:derive          # rebuild the generated pair from both sources
npm run history:import -- \
  --franchises=data/manual-history/franchises.csv \
  --seasons=data/manual-history/season-results.csv \
  --managers=data/manual-history/managers.csv \
  --manager-seasons=data/manual-history/manager-seasons.csv \
  --dry-run                     # drop --dry-run to write
```

198 season results and 221 manager assignments across 20 seasons.

Adding a new ESPN season is only `node scripts/backfill-history.mjs`, then
`npm run history:derive` and the import above — no mapping changes unless
someone new joins the league, in which case add their SWID to
`espn-managers.csv` (the derivation fails loudly on an unmapped account rather
than dropping the team).

## What had to be reconstructed, and what did not

**Nothing in the ESPN era.** `rankCalculatedFinal` gives the final placement,
the `WINNERS_BRACKET` matchups give the real playoff record (a bye is stored as
a matchup with no opponent and is not counted as a win), and `record.overall` is
regular-season only. The derivation cross-checks all three against each other:
the bracket winner must be the team ESPN ranks first, placements must be a
complete 1..10, and every team must have played the scheduled number of
regular-season games. Consolation-ladder games decide placement but are never
counted as playoff wins.

**The 2005-2017 playoff records.** The spreadsheet records a finish order, not a
bracket, and "lost in the semifinals" is `1-1` or `0-1` depending on a
first-round bye it never mentions. `lib/playoff-bracket.ts` commits to one
shape — six qualifiers, byes for seeds 1-2, first round 3v6 and 4v5, semifinals
1 vs the 4/5 winner — walks it forward, and throws when the recorded finish
order is unreachable rather than inventing a record. Twelve of thirteen seasons
fit directly under win-percentage-then-points-for seeding, and in every one the
six qualifiers are exactly the six best records.

That the ESPN seasons independently produce the same shape — six qualifiers,
five games, byes for the top two seeds, every year — is the strongest available
evidence that the assumed bracket is the bracket this league actually plays.

**2006 is the exception.** Boston Baked Beans went 9-4, tied for the best record
in the league, and lost in the first round, which cannot happen if the two best
records take the byes. A two-division season explains it and has exactly one
consistent solution: The Penguins (9-4) and Your Worst Nightmares (8-5) win the
divisions and take the byes, leaving Boston as the 3 seed behind a division
rival. That override lives in `SEASON_BYES` in `lib/history-archive.ts` and is
the only assumption in the whole import beyond the bracket shape.

## Franchise identity

A franchise is the durable slot, not the team name and not the person. Names
change constantly — Gary Camero alone used five in seven years — and slots
change hands.

| # | key | ESPN id | lineage |
|---|---|---|---|
| 1 | `bubbs` | 1 | Ryan throughout: Durham → New York → Austin Bubbs |
| 2 | `brightleaf-yuppies` | 8 | Jonathan Crisp throughout; Death by Glass Ingestion in 2005 |
| 3 | `penthouse-panda-bear` | 5 | Jeremy and Ben Wildfire, co-owners throughout |
| 4 | `p-rivers-nas-nas` | 6 | Samuel Nye throughout |
| 5 | `the-penguins` | 4 | Michael Chepul throughout |
| 6 | `your-worst-nightmares` | 3 | Joe Presley throughout |
| 7 | `run-and-hide` | 2 | Chris Phillips (Team 2) 2005-07 → Nathan Hanna 2008- |
| 8 | `cte-deniers` | 10 | Jimmy Hildebrand 2005 → Seamus McNeill 2006-08 → Trafton Drew 2009-17 → Jordan Chin 2018- |
| 9 | `raleigh-silly-nannies` | 9 | joined 2006: Eric King → John Mapp 2007-08 → Alan Marks 2009- |
| 10 | `taco-macarthur` | 11 | joined 2006: Blake Hudson → Justin McNally 2007 → Tommy Lawrence 2008 → Jonathan Ziebell 2009-10 → Gary Camero 2011- |

Six of these are the original 2005 owners. Franchises 9 and 10 were added in
2006 when Jimmy left and Seamus took over slot 8. The ESPN team ids have been
stable since 2018 and are confirmed by the owner accounts, not by team name.

## Where the two sources disagree about people

Both were settled by the commissioner, and both merge into one continuous
manager record:

- **Ryan.** The spreadsheets say *Ryan Soots*; the ESPN account that has held
  franchise 1 since 2018 is *Ryan Mindell*. Same person — the ledger records no
  handover on that franchise, ever. Shown as Ryan Mindell.
- **Marks.** The owner label reads *john marks* (2009), *Alan Marks*
  (2010-2017), and *John Marks* on the ESPN account from 2018 — one account
  renamed twice. One person, one record from the 2009 handover on. Shown as Alan
  Marks.

`managers.csv` carries an `archive_labels` column for exactly this: every name a
manager appeared under, so a rename does not read as a different person. A test
checks every transcribed owner label against it, which is the only check the
ledger's tenure ranges have.

Co-ownership is preserved rather than flattened: both Wildfires carry all their
shared seasons, as do Jordan Chin and Jason Campbell from 2023. Each season still
has exactly one primary manager — ESPN's `primaryOwner` decides it from 2018,
the ledger before that. The two sources disagree on which Wildfire leads (the
spreadsheet lists Jeremy first, ESPN records Ben), and each era is recorded as
its own source states.

## What the tables show

`/history` renders franchise records and manager records over everything above,
plus the championship roll. The views behind them are in
`scripts/migrations/2026-09-01-unified-history.sql`.

The ESPN team-ID table is still there, and still separate on purpose: it is
counted from the loaded week-by-week results with playoff weeks included, so it
is the raw feed rather than a franchise record. The rivalry and weekly features
hang off those ids.

## Limits

- **No head-to-head before 2018.** The spreadsheet has season totals, not
  matchups, so rivalry records cannot reach back. That would need ~13 screenshots
  a season.
- **Roster moves are transcribed but not loaded.** No column models them.
- **Regular-season points only** in the points column, so 12- and 13-game
  seasons sit below the modern 14-game years.
- **Final place means something slightly different per era.** Before 2018 places
  3-6 come from how far a team got in the bracket and 7+ from the regular-season
  order; from 2018 ESPN's consolation ladder decides the lower places. Champion,
  runner-up, and playoff records are exact in both.
