# Player ledger

The Players tab covers QB, RB, WR, TE, K and D/ST, including players who were
never rostered in Grudge. NFL statistics cover 1999–2025 and the 2026 directory
is ready for game data. Grudge fantasy scoring starts in **2005**. The initial
backfill contains **187,601 player-game records**; no 2026 games are invented.

## Product behavior

- `/players` defaults to the current NFL season (January/February still belong
  to the previous NFL season). Season, position, name, inclusive week range,
  schedule, sorting and pagination are encoded in the URL.
- Regular season means the **entire NFL regular season**, independently of the
  Grudge regular-season and championship-bracket windows. NFL playoffs are a
  separate filter. Opening a player preserves the selected weeks and schedule.
- Profiles show game logs, all available numeric game stats, season totals,
  Grudge drafts, completed adds/drops, active trades and observed roster stints.
- The historical manager mapping takes priority. The same season's ESPN
  owners supply names when the current year has not yet entered the results
  history. Co-owners are not arbitrarily reduced to a single manager.
- Contributions to Grudge teams count actual starts in completed regular and
  championship-bracket matchups. Consolation production is excluded. Roster
  snapshots still describe ownership without implying that those points count.
- Draft boards, draft records and trade player names link to the profiles.

## Data and identity

`nfl_players` is the canonical directory. `nfl_player_seasons` records the
season's fantasy position and NFL teams. `nfl_player_games` records production,
independent of any fantasy owner. The existing `player_week_scores` and grading
tables retain their contracts and horizons; this feature does not republish
draft/trade grades under a new formula.

GSIS is the NFL identity. ESPN aliases are explicitly **season-scoped** because
the early archives use a different namespace. Historical names must resolve
uniquely within the season and position, with team as a disambiguator. Reviewed
name variants live in `data/player-name-aliases.json`. Modern provider IDs are
corroborated against names. Defensive units use a franchise identity across
relocations. The fantasy-provider crosswalk preserves two-way players such as
Travis Hunter even when the NFL calls them defensive players.

Ambiguous identities retain an archive-only profile instead of being attached
to a plausible but wrong NFL player. A later resolution updates the season
alias, removes the duplicate directory entry and redirects the old archive URL.

The initial build resolves every named player in the roster archives. That does
not mean every historical transaction survives: before 2018, draft and final
roster facts cannot establish intermediate ownership or prove a trade. Failed
waivers, pending claims, trade proposals and lineup-only moves never become
acquisitions. Trade history reads the existing stable ledger and its evidence
status, so corrections are reflected without reconstructing another ledger.
Older transaction items with a missing normalized player ID can use the ID in
their preserved raw item. New imports retain those IDs with a non-destructive
player placeholder instead of nulling the foreign key.

## Scoring and evidence

The builder reads each year's archived ESPN `scoringItems`, including positional
overrides. This handles the changes from no PPR to partial PPR to half PPR, the
older passing-yard buckets, and the **2026 TE reception premium**. NFL generic
`fantasy_points` columns are never used as Grudge points.

Play-by-play supplies 40+ yard **touchdown** bonuses and distinct return types.
A 50-yard gain without a touchdown earns no touchdown bonus. Kicker distance
bands include blocked attempts in ESPN's missed-field-goal category. D/ST fumble
recoveries use `fumble_recovery_opp`, not nflverse's differently defined
`def_fumbles`. ESPN's 2017 D/ST change excludes opposing defensive scores from
points allowed; older years retain the earlier convention. The surviving 2018
weekly scores independently corroborate the changed behavior.

Recorded actual ESPN weekly totals take priority; projections, another season's
stats and empty blocks are rejected. The original calculation is retained for
comparison. Every position/season records comparison count, exact matches, mean
absolute error and maximum error in the artifact's validation receipt.
Reconstructed points are labeled, including where small provider differences
remain. A newly enabled unsupported rule or a material validation regression
stops the build rather than quietly dropping the rule.

No row is not a zero or a game played. The page's Games* column means games with
a stat record, and average divides by those records. Recorded zero points remain
zero. Missing/conflicting score evidence withholds a range total. Nonfinite NFL
ratio fields are unavailable, not zero. Known absence of a play-by-play bonus
in a covered game is explicitly zero. No fantasy points are stored before 2005.
The league did not play in 2020; NFL points that year apply its archived rules
without implying Grudge ownership or lineup contributions.

## Build, import and updates

```sh
npm run players:build-data -- --cache-dir /tmp/grudge-player-sources --seasons 1999:2026
npm run players:import -- --dry-run
npm run players:import
```

The Python builder uses only the standard library and curl. Raw CSV/play-by-play
files stay outside git; compressed season shards, the directory and checksummed
manifest are committed. A changed shard is imported only after the whole batch
passes validation. A season's stats, aliases, roster snapshots and publication
receipt land in one transaction under an advisory lock. A failed write leaves
that season's previous publication intact. `--force` replays validated shards
when repairing an import; a substantial unexplained row-count reduction still
fails the publication gate.

The dedicated `refresh-players.yml` job updates the current and prior NFL season
daily and shares the league pipeline's writer lock. It sends no emails. A new
current-season feed may legitimately return 404 before game data exists; losing
previously published games, a partial source set, a missing historical season or
missing scoring rules aborts publication. Changed rules/calculation code should
increment `player_scoring.VERSION` and rebuild the affected historical shards.
Workflow artifacts preserve fresh receipts and data for 14 days; the initial
backfill and code remain in git. Sources are retained by URL and SHA-256.

## Verification and rollout

Apply `scripts/migrations/2026-09-13-player-explorer.sql` as database owner before
merging the feature. It only adds six public-readable, RLS-enabled tables and
their indexes/policies. The pipeline role can write them; app/user roles cannot.
The migration and full backfill are tested on a Neon branch copied from the
production database before production application. No existing trade, vote,
correction, draft grade or membership record is changed by the migration.

Tests execute the actual SQL in PostgreSQL (PGlite), covering unrostered players,
inclusive week filters, zero versus missing scores, idempotent/failed imports,
season-specific identity and manager attribution, raw transaction recovery,
withdrawn trades, roster gaps, consolation exclusions and public-role writes.
Scoring tests use actual archived yearly settings and touchdown/non-touchdown
plays. CI verifies mobile and desktop browser flows against isolated PostgreSQL
fixtures and retains screenshots. This requires no production secrets:

```sh
npx playwright install --with-deps chromium
VERCEL_ENV=preview npm run build
node tests/players/verify-ui.mjs
```

## Sources

- [nflverse player stats](https://nflreadr.nflverse.com/reference/load_player_stats.html)
- [nflverse release data](https://github.com/nflverse/nflverse-data)
- [nflverse update schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)
- [Fantasy provider identity crosswalk](https://github.com/dynastyprocess/data)
- [ESPN scoring field definitions in espn-api](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/constant.py)
- [ESPN's 2017 D/ST announcement](https://www.youtube.com/watch?v=T9C8nPZEZiQ)
- Grudge's committed `data/history/` and `data/seasons/` archives.
