#!/usr/bin/env -S npx tsx
/**
 * Weekly pipeline.
 *
 *   npm run pipeline                  # current season, completed weeks only
 *   npm run pipeline -- --season=2023 # load one season from the local archive
 *   npm run pipeline -- --history     # load every archived season
 *   npm run pipeline -- --dry-run     # fetch, normalize, report -- write nothing
 *
 * ORDER OF OPERATIONS, and why:
 *   1. Fetch everything first.
 *   2. Archive raw JSON to data/ (append-only history; committed by CI).
 *   3. Decide which weeks are COMPLETE.
 *   4. Normalize.
 *   5. Write all of it in ONE transaction.
 *
 * Nothing reaches the database until every fetch has succeeded, so an ESPN
 * outage or a half-played Sunday leaves the previous state intact rather than
 * writing a partial week that later has to be un-picked. Re-running is always
 * safe: every write is an upsert on the natural key.
 */
import {
  mkdirSync, writeFileSync, renameSync, rmSync, existsSync, readFileSync, readdirSync, realpathSync,
} from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchLeague, fetchBoxscore, fetchProSchedule, LEAGUE_ID, type EspnLeague } from './espn.ts';
import {
  seasonRow, teamRows, matchupRows, rosterEntryRows, playerRows, weekRows,
  starterSlots, weekCompleteness, completedWeeks, finalScoringPeriod,
  transactionRows,
} from './normalize.ts';
import { detectTrades } from './trade-history.ts';
import { connect, runTransaction, upsertChunked, stmt, type Stmt } from './db.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;

const DRY_RUN = flag('dry-run');
const USE_HISTORY = flag('history');
const SEASON = Number(opt('season', String(new Date().getUTCFullYear())));

const log = (...a: unknown[]) => console.log(...a);

/* ------------------------------------------------------------- raw archive */

/**
 * ESPN fields that change on almost every request and mean nothing for this
 * league's history: analyst rankings, projected draft value, ownership
 * percentages, news timestamps. Measured, not guessed -- diffing two archives
 * taken hours apart showed 60 differing values and every one of them was in
 * here, while scores, rosters and transactions were identical.
 *
 * These are still ARCHIVED in full. They are only excluded from the decision
 * about whether a new snapshot is worth writing.
 */
export const VOLATILE_KEYS = new Set([
  'rankings', 'draftRanksByRankType', 'ownership', 'ratings',
  'lastNewsDate', 'lastVideoDate', 'seasonOutlook', 'draftAuctionValue',
]);

/** Deep copy with volatile keys removed, for change detection only. */
export function stableProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableProjection);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = stableProjection(v);
    }
    return out;
  }
  return value;
}

/**
 * Write a gzipped raw payload, but ONLY if something meaningful changed.
 *
 * Two problems this solves. gzip output is not byte-stable, and ESPN rewrites
 * analyst rankings continuously -- so a naive comparison would commit a few
 * hundred KB of noise every single Tuesday, forever, burying the weeks where
 * something actually happened.
 *
 * The comparison therefore runs over stableProjection(), but the file written
 * is the COMPLETE raw payload: the archive stays faithful to what ESPN served,
 * and we simply stop taking a new snapshot when nothing we care about moved.
 *
 * Returns whether it wrote, which decides whether the manifest -- whose
 * capturedAt changes by definition -- is worth rewriting.
 */
export function writeRaw(path: string, data: unknown): boolean {
  const full = JSON.stringify(data);
  if (existsSync(path)) {
    try {
      const existing = JSON.parse(gunzipSync(readFileSync(path)).toString());
      if (JSON.stringify(stableProjection(existing)) === JSON.stringify(stableProjection(data))) {
        return false;
      }
    } catch {
      // Unreadable or truncated archive -- fall through and rewrite it.
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, gzipSync(full, { level: 9 }));
  renameSync(tmp, path); // atomic: no reader ever sees a half-written file
  return true;
}

const readRaw = (path: string) => JSON.parse(gunzipSync(readFileSync(path)).toString());

/* ------------------------------------------------------------ data sources */

interface SeasonBundle {
  league: EspnLeague;
  boxscores: Map<number, EspnLeague>;
  proGames: Awaited<ReturnType<typeof fetchProSchedule>> | null;
}

/** Load a season from the committed archive (history, or a previous live run). */
function loadArchived(season: number): SeasonBundle | null {
  const dir = join(DATA, 'history', String(season));
  const leaguePath = join(dir, 'league.json.gz');
  if (!existsSync(leaguePath)) return null;
  const league = readRaw(leaguePath) as EspnLeague;
  league.seasonId ??= season;
  const boxscores = new Map<number, EspnLeague>();
  const bxDir = join(dir, 'boxscores');
  if (existsSync(bxDir)) {
    for (const f of readdirSync(bxDir)) {
      const m = /^sp(\d+)\.json\.gz$/.exec(f);
      if (!m || !m[1]) continue;
      boxscores.set(Number(m[1]), readRaw(join(bxDir, f)) as EspnLeague);
    }
  }
  return { league, boxscores, proGames: null };
}

/** Fetch the live season from ESPN and archive the raw payloads. */
async function fetchLive(season: number): Promise<SeasonBundle> {
  log(`fetching league ${LEAGUE_ID}, season ${season}`);
  const league = await fetchLeague(season);
  league.seasonId ??= season;

  const done = completedWeeks(league);
  log(`  completed weeks: ${done.length ? done.join(', ') : 'none yet'}`);

  const boxscores = new Map<number, EspnLeague>();
  for (const week of done) {
    boxscores.set(week, await fetchBoxscore(season, week));
    process.stdout.write(`  boxscore week ${week}\r`);
  }
  if (done.length) log(`  boxscores fetched: ${done.length}      `);

  const proGames = await fetchProSchedule(season);
  log(`  pro schedule: ${proGames.length} games`);

  // Archive only after every fetch above succeeded.
  const dir = join(DATA, 'seasons', String(season));
  let wrote = 0;
  if (writeRaw(join(dir, 'league.json.gz'), league)) wrote++;
  for (const [week, bx] of boxscores) {
    if (writeRaw(join(dir, 'boxscores', `sp${String(week).padStart(2, '0')}.json.gz`), bx)) wrote++;
  }
  if (writeRaw(join(dir, 'pro-schedule.json.gz'), proGames)) wrote++;

  // The manifest carries capturedAt, which changes every run by definition.
  // Rewriting it when nothing else changed would defeat the whole point of
  // the content check above, so it is only refreshed alongside real changes.
  if (wrote > 0) {
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify(
        { season, leagueId: LEAGUE_ID, capturedAt: new Date().toISOString(), completedWeeks: done },
        null, 2
      ) + '\n'
    );
    log(`  archived to data/seasons/${season}/ (${wrote} file(s) changed)`);
  } else {
    log(`  archive unchanged -- nothing new from ESPN`);
  }

  return { league, boxscores, proGames };
}

/* ------------------------------------------------------------ building SQL */

function buildStatements(bundle: SeasonBundle): { statements: Stmt[]; summary: Record<string, number> } {
  const { league, boxscores, proGames } = bundle;
  const season = league.seasonId;
  const statements: Stmt[] = [];
  const summary: Record<string, number> = {};

  const s = seasonRow(league);
  statements.push(
    stmt(
      `insert into public.seasons
         (season, league_name, team_count, regular_season_weeks, playoff_team_count,
          final_scoring_period, faab_budget, playoff_seeding_rule, settings_raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (season) do update set
         league_name = excluded.league_name, team_count = excluded.team_count,
         regular_season_weeks = excluded.regular_season_weeks,
         playoff_team_count = excluded.playoff_team_count,
         final_scoring_period = excluded.final_scoring_period,
         faab_budget = excluded.faab_budget,
         playoff_seeding_rule = excluded.playoff_seeding_rule,
         settings_raw = excluded.settings_raw, updated_at = now()`,
      [s.season, s.league_name, s.team_count, s.regular_season_weeks, s.playoff_team_count,
       s.final_scoring_period, s.faab_budget, s.playoff_seeding_rule, JSON.stringify(s.settings_raw)]
    )
  );
  summary.seasons = 1;

  const members = (league.members ?? []).map((m) => ({
    season, swid: m.id, display_name: m.displayName ?? null,
    first_name: m.firstName ?? null, last_name: m.lastName ?? null,
  }));
  statements.push(...upsertChunked('public.members',
    ['season', 'swid', 'display_name', 'first_name', 'last_name'], members, ['season', 'swid']));
  summary.members = members.length;

  const teams = teamRows(league);
  statements.push(...upsertChunked('public.teams',
    ['season', 'espn_team_id', 'name', 'abbrev', 'logo_url', 'division_id', 'primary_owner_swid', 'waiver_rank', 'faab_spent'],
    teams as unknown as Record<string, unknown>[], ['season', 'espn_team_id']));
  summary.teams = teams.length;

  const owners = (league.teams ?? []).flatMap((t) =>
    (t.owners ?? []).map((swid) => ({
      season, espn_team_id: t.id, swid, is_primary: swid === t.primaryOwner,
    }))
  );
  statements.push(...upsertChunked('public.team_owners',
    ['season', 'espn_team_id', 'swid', 'is_primary'], owners, ['season', 'espn_team_id', 'swid']));
  summary.team_owners = owners.length;

  // Weeks must exist before matchups (FK) and carry the lock times predictions depend on.
  const regular = league.settings?.scheduleSettings.matchupPeriodCount ?? 14;
  let weeks = proGames ? weekRows(season, proGames, regular) : [];
  if (weeks.length === 0) {
    // Archived seasons have no pro schedule; synthesize week rows from the
    // schedule itself so FKs resolve. Lock times stay null -- historical weeks
    // are long past and nothing can be predicted for them anyway.
    const seen = [...new Set(matchupRows(league).map((m) => m.week))].sort((a, b) => a - b);
    weeks = seen.map((w) => ({
      season, week: w, first_kickoff_at: null, last_kickoff_at: null,
      has_tbd_kickoff: false, is_playoff: w > regular,
    }));
  }
  const finalPeriod = finalScoringPeriod(league);
  const weekRowsToWrite = weeks.filter((w) => w.week <= finalPeriod);
  statements.push(...upsertChunked('public.weeks',
    ['season', 'week', 'first_kickoff_at', 'last_kickoff_at', 'has_tbd_kickoff', 'is_playoff'],
    weekRowsToWrite as unknown as Record<string, unknown>[], ['season', 'week']));
  summary.weeks = weekRowsToWrite.length;

  // PICKS LOCK ON SATURDAY. The upsert above rewrites first_kickoff_at every
  // run -- ESPN reschedules flex games -- so the lock has to be recomputed from
  // it in the same transaction, or a moved kickoff would silently move the
  // deadline. saturday_lock() is midnight at the end of Saturday night US
  // Eastern; the arithmetic lives in Postgres so daylight saving is handled.
  statements.push(stmt(
    `update public.weeks
        set locks_at = public.saturday_lock(first_kickoff_at)
      where season = $1
        and first_kickoff_at is not null
        and locks_at is distinct from public.saturday_lock(first_kickoff_at)`,
    [season]
  ));

  const knownWeeks = new Set(weekRowsToWrite.map((w) => w.week));
  const matchups = matchupRows(league).filter((m) => knownWeeks.has(m.week));
  statements.push(...upsertChunked('public.matchups',
    ['season', 'espn_matchup_id', 'week', 'home_team_id', 'away_team_id', 'home_points', 'away_points', 'winner', 'playoff_tier', 'is_final'],
    matchups as unknown as Record<string, unknown>[], ['season', 'espn_matchup_id']));
  summary.matchups = matchups.length;

  // Mark completed weeks so downstream features know what is safe to compute.
  for (const week of completedWeeks(league)) {
    if (!knownWeeks.has(week)) continue;
    statements.push(stmt(
      `update public.weeks set status = 'final', results_complete = true
       where season = $1 and week = $2`, [season, week]));
  }

  const starters = starterSlots(league);
  let players: ReturnType<typeof playerRows> = [];
  let entries: ReturnType<typeof rosterEntryRows> = [];
  const seenPlayers = new Set<number>();
  for (const [week, bx] of [...boxscores.entries()].sort((a, b) => a[0] - b[0])) {
    if (!knownWeeks.has(week)) continue;
    bx.seasonId ??= season;
    for (const p of playerRows(bx)) {
      if (seenPlayers.has(p.espn_player_id)) continue;
      seenPlayers.add(p.espn_player_id);
      players.push(p);
    }
    entries = entries.concat(rosterEntryRows(bx, week, starters));
  }
  statements.push(...upsertChunked('public.players',
    ['espn_player_id', 'full_name', 'default_position_id', 'pro_team_id', 'eligible_slots'],
    players as unknown as Record<string, unknown>[], ['espn_player_id']));
  summary.players = players.length;

  statements.push(...upsertChunked('public.roster_entries',
    ['season', 'week', 'espn_team_id', 'espn_player_id', 'lineup_slot_id', 'is_starter', 'applied_points', 'projected_points', 'acquisition_type', 'injury_status'],
    entries as unknown as Record<string, unknown>[], ['season', 'week', 'espn_team_id', 'espn_player_id']));
  summary.roster_entries = entries.length;

  // Transactions: envelope + items. `raw` is retained deliberately -- only
  // DRAFT records have ever been observed for this league, so the first real
  // waiver claim tells us the truth without a lost record.
  const txRows = transactionRows(league, knownWeeks);
  statements.push(...upsertChunked('public.transactions',
    ['espn_transaction_id', 'season', 'week', 'espn_team_id', 'type', 'status', 'execution_type', 'bid_amount', 'is_pending', 'proposed_at', 'raw'],
    txRows as unknown as Record<string, unknown>[], ['espn_transaction_id']));
  summary.transactions = txRows.length;

  // Items come from the same filtered set, so an unclassifiable transaction
  // cannot leave orphaned items behind.
  const keptIds = new Set(txRows.map((t) => t.espn_transaction_id));
  const txns = (league.transactions ?? []).filter((t) => keptIds.has(t.id));
  const items = txns.flatMap((t) =>
    (t.items ?? []).map((it, i) => ({
      espn_transaction_id: t.id, item_index: i, espn_player_id: it.playerId ?? null,
      item_type: it.type ?? null, from_team_id: it.fromTeamId ?? null, to_team_id: it.toTeamId ?? null,
      from_lineup_slot_id: it.fromLineupSlotId ?? null, to_lineup_slot_id: it.toLineupSlotId ?? null,
      overall_pick_number: it.overallPickNumber ?? null, is_keeper: it.isKeeper ?? false,
    }))
  );
  // Transaction items reference players; a drafted player may not appear in any
  // boxscore we loaded, so null the FK rather than fail the whole transaction.
  const knownPlayers = new Set(players.map((p) => p.espn_player_id));
  for (const it of items) if (it.espn_player_id && !knownPlayers.has(it.espn_player_id)) it.espn_player_id = null;
  statements.push(...upsertChunked('public.transaction_items',
    ['espn_transaction_id', 'item_index', 'espn_player_id', 'item_type', 'from_team_id', 'to_team_id', 'from_lineup_slot_id', 'to_lineup_slot_id', 'overall_pick_number', 'is_keeper'],
    items, ['espn_transaction_id', 'item_index']));
  summary.transaction_items = items.length;

  // Trades, reconstructed. ESPN sends a TRADE_ACCEPT with an empty items array
  // and no way to resolve the proposal it references, so the contents come
  // from diffing consecutive weekly rosters against the add/drop ledger --
  // see pipeline/trade-history.ts for why that is sound.
  //
  // Recomputed from scratch every run rather than appended to. Trade ids are
  // deterministic, so a re-detection updates in place; a trade that stops
  // being detected was wrong, and deleting it (votes included) is the point.
  const trades = detectTrades(season, entries, league.transactions ?? []);
  statements.push(stmt(
    `delete from public.trades where season = $1 and trade_id <> all($2::text[])`,
    [season, trades.map((t) => t.trade_id)]
  ));
  if (trades.length) {
    statements.push(...upsertChunked('public.trades',
      ['season', 'trade_id', 'effective_week', 'team_a', 'team_b', 'espn_transaction_id', 'accepted_at', 'confidence'],
      trades.map(({ players: _players, ...row }) => row) as unknown as Record<string, unknown>[],
      ['season', 'trade_id']));
    // Open voting on trades seen for the first time, and ONLY those. This is a
    // separate statement rather than a column in the upsert above because the
    // upsert runs every week: including it would push the deadline forward on
    // every run and voting would never close.
    statements.push(stmt(
      `update public.trades
          set voting_closes_at = now() + public.trade_voting_window()
        where season = $1 and voting_closes_at is null`,
      [season]
    ));
    const tradePlayers = trades.flatMap((t) =>
      t.players.map((p) => ({ season, trade_id: t.trade_id, ...p })));
    // Replaced wholesale rather than upserted: a player the previous detection
    // put in a trade and this one does not must not linger, and there is no
    // user-owned data here to preserve. Same transaction, so no reader ever
    // sees the gap.
    statements.push(stmt('delete from public.trade_players where season = $1', [season]));
    statements.push(...upsertChunked('public.trade_players',
      ['season', 'trade_id', 'espn_player_id', 'from_team_id', 'to_team_id'],
      tradePlayers as unknown as Record<string, unknown>[],
      ['season', 'trade_id', 'espn_player_id']));
  }
  summary.trades = trades.length;

  return { statements, summary };
}

/* -------------------------------------------------------------------- main */

async function loadSeason(bundle: SeasonBundle) {
  const season = bundle.league.seasonId;
  const { statements, summary } = buildStatements(bundle);
  log(`  ${statements.length} statements; rows: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (DRY_RUN) { log('  --dry-run: nothing written'); return; }
  const sql = connect();
  await runTransaction(sql, statements);
  log(`  season ${season} committed`);
}

async function main() {
  if (USE_HISTORY) {
    const dir = join(DATA, 'history');
    const seasons = existsSync(dir)
      ? readdirSync(dir).filter((d) => /^\d{4}$/.test(d)).map(Number).sort()
      : [];
    log(`archived seasons: ${seasons.join(', ') || 'none'}`);
    for (const season of seasons) {
      const bundle = loadArchived(season);
      if (!bundle) continue;
      const decided = matchupRows(bundle.league).filter((m) => m.is_final).length;
      log(`\n${season}: ${decided} completed matchups`);
      if (decided === 0) {
        // 2020: the league did not play. Archive kept, but nothing to load.
        log('  skipped -- season has no completed matchups');
        continue;
      }
      await loadSeason(bundle);
    }
    return;
  }

  const archived = loadArchived(SEASON);
  const bundle = archived ?? (await fetchLive(SEASON));
  if (archived) log(`${SEASON}: loaded from local archive`);

  const done = completedWeeks(bundle.league);
  if (done.length === 0) {
    log(`\n${SEASON}: no completed weeks yet.`);
    log('Reference data (teams, members, schedule, lock times) will still load;');
    log('no results, rosters or derived rows are written for an unplayed week.');
  }
  log(`\n${SEASON}:`);
  await loadSeason(bundle);
}

// Only run the pipeline when invoked directly, so tests can import the archive
// helpers above without kicking off a fetch. Compared as resolved real paths,
// not basenames: matching on "run.ts" alone would fire for any entry point that
// happens to share the filename, and symlinked or relative invocations
// (`tsx ./pipeline/run.ts`) have to keep working.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((e) => {
    console.error(`\npipeline failed: ${e instanceof Error ? e.message : String(e)}`);
    console.error('Nothing was written -- the run is transactional.');
    process.exit(1);
  });
}
