# Pre-2018 history from screenshots

ESPN's API returns 404 for this league before 2018 even with owner cookies, so
anything earlier can only come from screenshots. The 2017 screenshots confirm
that is worth doing — and surface a trap.

## What the 2017 screenshots actually give us

| screenshot | value | what it yields |
|---|---|---|
| **Final Standings** | **highest** | full W-L-T, PF, PA, PF/G, PA/G, moves — a complete season record for all 10 teams |
| **Playoff bracket** | **high** | champion, runner-up, third, and real playoff scores |
| Draft results | low | interesting, but feeds no standing, record or rivalry |

## The trap: team identity is NOT stable before 2018

The API era (2018-2026) has stable `espn_team_id` -> franchise mapping, which is
why `head_to_head` can join on team id. 2017 breaks that assumption:

- **"Boston Double Rainbows" (Trafton Drew)** is a franchise that no longer
  exists and belongs to no current member.
- **"W. Durham Silly Nannies"** is the team now called *Raleigh Silly Nannies*.
- **"Austin Bubbs"** is listed under **Ryan Soots**, not Ryan Mindell.
- 2017 ran a **13-week** regular season (records are 7-6-0, 11-2-0) with
  playoffs in NFL weeks 14-16; the modern seasons run 14 weeks.

So pre-2018 seasons must be loaded with an explicit franchise mapping supplied
by a human, not by matching on name or id. Anything else silently merges two
different owners' records into one "team".

## Recommendation on what else to send

**Send: Final Standings + the champion/bracket screenshot, one pair per season**
for whichever years exist (the 2020 payload's `previousSeasons` claims 2005
onward). That is 2 images per season and yields all-time records, title counts,
and career points.

**Do not bother with draft screenshots.** High effort, no feature depends on them.

**Known limitation, stated up front:** standings screenshots give season
*totals*, not individual matchups, so pre-2018 years can extend all-time
records and championships but **cannot** extend head-to-head rivalry records.
Those need per-week scores, which would be ~13 screenshots per season. Not worth
it unless you specifically want rivalry data going back further.
