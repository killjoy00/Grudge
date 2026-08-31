# Pre-2018 history: 2005-2017, recovered and loaded

ESPN's API returns 404 for this league before 2018 even with owner cookies, so
anything earlier can only come from human records. It did: a commissioner's
spreadsheet covering **every season from 2005 through 2017**, plus a written
ledger of who owned which franchise in which year.

That archive is now checked in and importable. This document is what it says,
what had to be reconstructed to load it, and what is still missing.

## The files

| file | what it is |
|---|---|
| `data/manual-history/standings-2005-2017.csv` | Straight transcription of the spreadsheet. One row per team per season, in finish order. **Edit this one** if a number is wrong. |
| `data/manual-history/season-results.csv` | Generated from it by `npm run history:derive`. Never hand-edit. |
| `data/manual-history/franchises.csv` | The ten durable franchises and their lineage. |
| `data/manual-history/managers.csv`, `manager-tenures.csv` | Who ran which franchise, as joined/left ranges. |

Load it with:

```bash
npm run history:derive          # regenerate season-results.csv
npm run history:import -- \
  --franchises=data/manual-history/franchises.csv \
  --seasons=data/manual-history/season-results.csv \
  --managers=data/manual-history/managers.csv \
  --tenures=data/manual-history/manager-tenures.csv \
  --dry-run                     # drop --dry-run to write
```

128 season results across 13 seasons, 10 franchises, 20 managers.

## What the spreadsheet gives, and what it doesn't

Each row has the team name, the owner label, W-L-T, points for and against, and
the number of roster moves. Records arrive Excel-mangled — `7-6-0` is stored as
`7-6-2000` — so **ties are always zero**; there are no ties anywhere in the
archive. Seasons are 13 games from 2006 on and 12 games in 2005.

Rows are ordered by **playoff finish**, not by record: 1st won the title, 2nd
lost the final, 3rd and 4th lost the semifinals, 5th and 6th lost the first
round, and 7th onward are the non-qualifiers in regular-season order.

The archive has **no per-week scores**, so pre-2018 seasons extend all-time
records, championships and career points but **cannot** extend head-to-head
rivalry records. Roster-move counts are transcribed but not loaded — no column
models them.

## The one thing that had to be reconstructed: playoff records

A finish order is not a bracket. To turn "lost in the semifinals" into `1-1` you
have to know whether that team had a first-round bye, which the spreadsheet
never states. `lib/playoff-bracket.ts` commits to a single shape and refuses to
guess when a season doesn't fit it:

- six qualifiers; seeds 1-2 bye
- first round 3v6 and 4v5
- semifinals 1 vs the 4/5 winner, 2 vs the 3/6 winner
- seeding by win percentage, then points for

Twelve of thirteen seasons drop straight out of that. In every one, the six
qualifiers are exactly the six best records, and the recorded finish order is
reachable by walking the bracket forward — a real check, not a tautology, since
most finish orders are not reachable.

**2006 is the exception.** Boston Baked Beans finished 9-4, tied for the best
record in the league, and lost in the first round. That cannot happen if the two
best records take the byes. A two-division season explains it, and under two
divisions there is exactly one consistent assignment: The Penguins (9-4) and
Your Worst Nightmares (8-5) win their divisions and take the byes, putting
Boston at the 3 seed behind a division rival. That override lives in
`SEASON_BYES` in `lib/history-archive.ts` and is the only assumption in the
import beyond the bracket shape itself. It affects two rows: the 2006 champion's
record (3-0 rather than 2-0) and The Penguins' (0-1 rather than 1-1).

`lib/history-archive.test.ts` re-derives the whole archive on every test run and
fails if `season-results.csv` drifts from the transcription.

## Franchise identity

A franchise is the durable slot, not the team name and not the person. Names
change constantly — Gary Camero alone used five in seven years — and slots
change hands. The ledger:

| # | key | lineage |
|---|---|---|
| 1 | `bubbs` | Ryan Soots throughout: Durham → New York → Austin Bubbs |
| 2 | `brightleaf-yuppies` | Jonathan Crisp throughout; Death by Glass Ingestion in 2005 |
| 3 | `penthouse-panda-bear` | jeremy and Ben Wildfire, co-owners throughout |
| 4 | `p-rivers-nas-nas` | Samuel Nye throughout |
| 5 | `the-penguins` | Michael Chepul throughout |
| 6 | `your-worst-nightmares` | Joe Presley throughout |
| 7 | `run-and-hide` | Chris Phillips (Team 2) 2005-07 → Nathan Hanna 2008- |
| 8 | `cte-deniers` | Jimmy Hildebrand 2005 → Seamus McNeill 2006-08 → Trafton Drew 2009-17 → Jordan 2018- |
| 9 | `raleigh-silly-nannies` | joined 2006: Eric King → John Mapp 2007-08 → Alan Marks 2009- |
| 10 | `taco-macarthur` | joined 2006: Blake Hudson → Justin McNally 2007 → Tommy Lawrence 2008 → Jonathan Ziebell 2009-10 → Gary Camero 2011- |

Six of these are the original 2005 owners. Franchises 9 and 10 were added in
2006 when Jimmy left and Seamus took over slot 8.

One row disagrees with the ledger: the 2009 Silly Nannies list their owner as
"john marks", while the ledger records that year as the handover to Alan Marks.
The tenure file follows the ledger and the test that cross-checks owner labels
against tenures exempts exactly that row.

## Still open: joining the two eras

The history page keeps the ESPN-id table (2018-) separate from the franchise
archive, because the database has no franchise ↔ `espn_team_id` mapping. That
mapping is now known and recorded in the `notes` column of `franchises.csv`
(ids 1, 2, 3, 4, 5, 6, 8, 9, 10, 11 in franchise order above), so wiring
`franchise_seasons.espn_team_id` for 2018+ and merging the tables is a
self-contained follow-up. It was left out here to keep this change to the
archive itself.
