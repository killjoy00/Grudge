# Trade evidence, 2005–2017

The recovered archives contain draft boards and final rosters, but **no transactions and no weekly roster files in any of these 13 seasons**. They support 366 draft-to-final owner changes and 48 reciprocal team-pair groups. These are investigation leads, not confirmed trade counts.

| Season | Owner changes | Reciprocal team-pair leads |
|---|---:|---:|
| 2005 | 25 | 4 |
| 2006 | 50 | 2 |
| 2007 | 19 | 0 |
| 2008 | 22 | 2 |
| 2009 | 24 | 3 |
| 2010 | 27 | 3 |
| 2011 | 31 | 6 |
| 2012 | 28 | 5 |
| 2013 | 22 | 6 |
| 2014 | 39 | 6 |
| 2015 | 26 | 4 |
| 2016 | 30 | 5 |
| 2017 | 23 | 2 |

A player could have been dropped, claimed, traded several times, or moved as part of several different packages. Two endpoint changes in opposite directions across an entire season do not establish one transaction. Acquisition dates/types in the final rosters are also absent. No trade dates or grades are inferred.

Several pairs with early-round players on both sides make useful places to look for old emails, screenshots or league messages:

| Season | Early picks whose final owners crossed |
|---|---|
| 2009 | Terrell Owens (pick 40) / Steve Smith (pick 22) |
| 2014 | Rob Gronkowski (pick 36) / Julius Thomas (pick 27) |
| 2014 | Alshon Jeffery (pick 25) / Le'Veon Bell (pick 28) |
| 2016 | Mark Ingram (pick 21) / Julio Jones (pick 4) |
| 2016 | Brandon Marshall (pick 25) / Lamar Miller (pick 13) |

These names identify the endpoints worth investigating; the table does not assert that they were directly exchanged. The full file includes the other visible player moves and both team names.

Reproduce the analysis with `npm run history:trade-evidence`. The output is `data/derived/legacy-trade-evidence.json`, with the source archive path for every season. It is deliberately separate from the trade importer.

The existing authenticated recovery/backfill workflows already document the unavailable pre-2018 transaction ledger. Fresh anonymous probes of the leagueHistory transaction/boxscore views for 2005, 2010 and 2017 returned API errors rather than additional evidence; they do not independently establish what an authenticated response would contain. No new authenticated capture was performed in this review.

A dated receipt with the complete package could establish an older trade record. Team-fit and ownership-limited production grades would additionally need the subsequent weekly ownership evidence. NFL player scoring alone cannot recover those ownership histories.
