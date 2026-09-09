# Grudge data model

Grudge keeps provider records, league history and real-world people separate. The rule is simple: **source-system ids describe evidence; canonical keys describe identity.**

## 1. Franchise

`franchises.franchise_key` is the durable competitive lineage used by Grudge history. A franchise survives team-name changes, ESPN team-id changes and manager changes.

Do not infer a franchise from a team name or from an ESPN id used in another season.

## 2. Franchise season team

`franchise_season_teams (season, franchise_key)` is the explicit identity of a franchise in one league season. It stores that season's `team_name` and optional `espn_team_id`.

This row can exist before any games are played. `team_franchise` resolves an ESPN team only through this exact-season mapping; a missing mapping stays missing rather than falling back to a prior season.

`franchise_season_results` is separate and contains only settled season outcomes: regular-season record and points, playoff record, finish and title flags. The `franchise_seasons` view temporarily exposes the old combined read shape for result-oriented code.

## 3. Manager

`managers.manager_key` is the historical human identity used for league records. `manager_franchise_seasons` assigns one or more managers to a franchise-season identity and supports co-management without splitting the franchise.

A manager is not the same thing as a Clerk profile, an ESPN member/SWID or a franchise. Those records may refer to the same real person but have different lifecycles and purposes.

## 4. NFL player

`nfl_players.player_key` is the canonical football-player identity everywhere outside raw provider ingestion. Player production (`nfl_player_games`, `player_week_scores`) and application-facing player history should use `player_key`.

`nfl_player_aliases (season, espn_player_id)` is the season-aware crosswalk from ESPN evidence to the canonical player. ESPN ids are not assumed to be globally durable. `player_identity` is the application bridge when a query begins with a season + ESPN player id.

The legacy `players` table remains an ESPN-ingestion/cache table while older code is migrated. New domain tables should not use it as their canonical identity source.

## 5. Authenticated member / provider member

These are intentionally distinct from historical managers:

- `profiles` = authenticated Grudge account and site preferences/authorization.
- `members` = an ESPN member record for a particular season.
- `team_owners` = ESPN's season-specific ownership relationship.
- `managers` = the durable person credited in Grudge historical records.

Never equate these solely by display name. Explicit provisioning/crosswalk data is authoritative.

## Join rules

- Matchups, drafts, trades, rosters and other ESPN team facts begin with `(season, espn_team_id)` and resolve through `franchise_season_teams` / `team_franchise`.
- ESPN player facts begin with `(season, espn_player_id)` and resolve through `nfl_player_aliases` / `player_identity`.
- Historical aggregate results begin with `(season, franchise_key)` in `franchise_season_results`.
- Human historical attribution begins with `(season, franchise_key)` in `manager_franchise_seasons`.
- A missing crosswalk is data-quality evidence. Do not repair it by guessing from a previous id, a current id, a name or a roster coincidence.
