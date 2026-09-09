# Grudge data model

Grudge keeps provider records, league history and real-world people separate. The rule is simple: **source-system ids describe evidence; canonical keys describe identity.**

## 1. Franchise

`franchises.franchise_key` is the durable competitive lineage used by Grudge history. A franchise survives team-name changes, ESPN team-id changes and manager changes.

Do not infer a franchise from a team name or from an ESPN id used in another season.

`franchise_espn_team_ranges` is the reviewed provider crosswalk. Its season ranges explicitly say which franchise an ESPN team id represents. If ESPN reuses an id, close the old range and add a new one; never carry identity forward implicitly.

## 2. Franchise season team

`franchise_season_teams (season, franchise_key)` is the explicit identity of a franchise in one league season. It stores that season's `team_name` and optional `espn_team_id`.

This row can exist before any games are played. `team_franchise` resolves an ESPN team only through this exact-season mapping; a missing mapping stays missing rather than falling back to a prior season. Live `teams` rows populate it only when an explicit `franchise_espn_team_ranges` row covers that season.

`franchise_season_results` is separate and contains only settled season outcomes: regular-season record and points, playoff record, finish and title flags. The `franchise_seasons` view temporarily exposes the old combined read shape for result-oriented code.

Current-season pages that need the field, manager, power/luck identity or a team link should begin with `franchise_season_teams`. They may overlay weekly/live results while the season is in progress, but must not require a `franchise_season_results` row to discover who the franchise is.

## 3. Manager

`managers.manager_key` is the historical human identity used for league records. `manager_franchise_seasons` assigns one or more managers to a franchise-season identity and supports co-management without splitting the franchise.

A manager is not the same thing as a Clerk profile, an ESPN member/SWID or a franchise. Those records may refer to the same real person but have different lifecycles and purposes.

For live seasons, `manager_espn_members` is the reviewed crosswalk from an ESPN member/SWID to a durable manager. A primary `team_owners` row can therefore create an explicit current-season manager assignment before season results exist. Historical attribution remains commissioner-authored.

## 4. NFL player

`nfl_players.player_key` is the canonical football-player identity everywhere outside raw provider ingestion. Player production (`nfl_player_games`, `player_week_scores`) and application-facing player history should use `player_key`.

`nfl_player_aliases (season, espn_player_id)` is the season-aware crosswalk from ESPN evidence to the canonical player. ESPN ids are not assumed to be globally durable. `player_identity` is the application bridge when a query begins with a season + ESPN player id. D/ST scores use the canonical `dst:*` player keys rather than parallel negative-ESPN-id identities.

The legacy `players` table remains an ESPN-ingestion/cache table while older code is migrated. New domain tables should not use it as their canonical identity source.

### Player table boundaries

Raw/source evidence may retain an ESPN player id because that is what the provider actually supplied. In this repository that includes `draft_picks`, `roster_entries`, `transaction_items`, `players`, `player_ownership_snapshots` and `player_season_profiles`. Code crossing from those rows into application/domain logic resolves `(season, espn_player_id)` through `nfl_player_aliases` / `player_identity` first. An unresolved source row remains unresolved rather than being guessed into a player career.

Derived/domain rows must carry the canonical identity. `player_week_scores.player_key`, `trade_players.player_key` and `draft_grade_results.player_key` reference `nfl_players(player_key)`. Their `espn_player_id` columns, where retained, are provenance only and are not valid cross-season join keys.

`legacy_draft_performance` is a compatibility/import staging table for the recovered 2008–2017 draft model evidence. It still records the ESPN source id but is not an application identity table; published draft grades resolve that evidence to `player_key`. `weekly_awards.espn_player_id` is optional provider detail and is currently unused for the stored team-level awards, so it is not promoted into a parallel player identity.

A reconstructed NFL score can legitimately have a canonical `player_key` without a league ESPN alias when the player was never observed in the fantasy-league provider evidence. Do not invent an ESPN alias merely to make every reconstructed score row have one.

## 5. Authenticated member / provider member

These are intentionally distinct from historical managers:

- `profiles` = authenticated Grudge account and site preferences/authorization.
- `members` = an ESPN member record for a particular season.
- `team_owners` = ESPN's season-specific ownership relationship.
- `manager_espn_members` = reviewed provider-member-to-manager crosswalk for live seasons.
- `managers` = the durable person credited in Grudge historical records.

Never equate these solely by display name. Explicit provisioning/crosswalk data is authoritative.

## Join rules

- Matchups, drafts, trades, rosters and other ESPN team facts begin with `(season, espn_team_id)` and resolve through `franchise_season_teams` / `team_franchise`.
- ESPN player facts begin with `(season, espn_player_id)` and resolve through `nfl_player_aliases` / `player_identity`.
- Historical aggregate results begin with `(season, franchise_key)` in `franchise_season_results`.
- Human historical attribution begins with `(season, franchise_key)` in `manager_franchise_seasons`.
- Application player links and derived joins use `player_key`; an ESPN-id URL is only a source-resolution bridge when the source row itself has no canonical key yet.
- A missing crosswalk is data-quality evidence. Do not repair it by guessing from a previous id, a current id, a name or a roster coincidence.
