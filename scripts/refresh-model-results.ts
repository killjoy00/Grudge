/** Import canonical scoring and atomically publish versioned model results. */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { connect, runTransaction, upsertChunked } from '../pipeline/db.ts';
import { canonicalPlayerKey, digest, observedPlayerWeeks, scoreStatements, type PlayerWeekScore, type ScoringEvidence } from '../pipeline/player-week.ts';
import { draftInputsFromScores, draftPublicationStatements, tradePublicationStatements } from '../pipeline/model-publish.ts';
import { loadTradeContext, type ModelQuery } from '../pipeline/model-context.ts';
import { gradeDrafts, type DraftPerformanceSeason } from '../pipeline/draft-model.ts';
import type { DetectedTrade } from '../pipeline/trade-history.ts';
import { detectTrades } from '../pipeline/trade-history.ts';
import { tradeWriteStatements } from '../pipeline/trade-identity.ts';
import { completedWeeks, rosterEntryRows, playerRows, starterSlots } from '../pipeline/normalize.ts';
import type { EspnLeague } from '../pipeline/espn.ts';
import { historicalPlayerRegistryStatements } from '../pipeline/player-import.ts';

const root = new URL('../', import.meta.url);
const dryRun = process.argv.includes('--dry-run');
const manifest = JSON.parse(readFileSync(new URL('data/derived/model-evidence-manifest.json', root), 'utf8')) as { files: Record<string,string> };
for (const name of ['draft-performance.json', 'draft-performance-provenance.json', 'player-week-scores.json.gz', 'player-identities.json']) {
  const hash = createHash('sha256').update(readFileSync(new URL(`data/derived/${name}`, root))).digest('hex');
  if (manifest.files[name] !== hash) throw new Error(`Scoring artifact mismatch: ${name}; complete the evidence rebuild before publishing`);
}
const bases: DraftPerformanceSeason[] = JSON.parse(readFileSync(new URL('data/derived/draft-performance.json', root), 'utf8')).seasons;
const file = readFileSync(new URL('data/derived/player-week-scores.json.gz', root));
const data = JSON.parse(gunzipSync(file).toString()) as { schema_version: number; seasons: {
  season: number; regular_weeks: number; scoring_hash: string;
  rows: [string, number | null, number, number, number, ScoringEvidence][];
}[] };
if (data.schema_version !== 1 || data.seasons.length !== bases.length) throw new Error('Incomplete or unsupported canonical scoring artifact');
const artifactHash = digest(file.toString('base64'));
const scores: PlayerWeekScore[] = data.seasons.flatMap((s) => s.rows.map(([gsis, espn, pos, week, points, evidence]) => ({
  season: s.season, week, player_key: `gsis:${gsis}`, espn_player_id: espn,
  position_id: pos, points, evidence, source: evidence === 'observed' ? 'historical_espn' : 'nflverse',
  scoring_version: s.scoring_hash, input_hash: digest([artifactHash, s.season, week, gsis]),
})));
if (scores.some((s) => !Number.isFinite(s.points) || !['observed', 'reconstructed', 'verified_zero'].includes(s.evidence))
  || new Set(scores.map((s) => `${s.season}:${s.week}:${s.player_key}`)).size !== scores.length) throw new Error('Invalid or duplicate canonical score');
const archivedBoards = bases.flatMap((s) => (s.board ?? []).map(([pick, team, player]) => ({
  season: s.season, overall_pick: pick, espn_team_id: team, espn_player_id: player,
})));
const offline = draftInputsFromScores(bases, scores, archivedBoards);
if (Object.values(offline.coverage).some((c) => !c.ready)) throw new Error(`Artifact coverage failure: ${JSON.stringify(offline.coverage)}`);
console.log(`${scores.length} canonical player-weeks; ${gradeDrafts(offline.seasons).length} draft grades across ${bases.length} complete seasons`);

if (!dryRun) {
  const sql = connect();
  const query: ModelQuery = (text, params = []) => sql.query(text, params) as never;
  const positionNames = new Map([[1, 'QB'], [2, 'RB'], [3, 'WR'], [4, 'TE']]);
  for (const season of data.seasons) {
    const base = bases.find((candidate) => candidate.season === season.season);
    if (!base?.player_registry?.length) throw new Error(`${season.season}: missing historical player registry evidence`);
    const registry = base.player_registry.map(([gsis, positionId, fullName]) => {
      const position = positionNames.get(positionId);
      if (!position || !fullName) throw new Error(`${season.season}: invalid historical player registry row ${gsis}`);
      return { player_key: `gsis:${gsis}`, full_name: fullName, position, bio: {} };
    });
    const registryKeys = new Set(registry.map((player) => player.player_key));
    const seasonScores = scores.filter((score) => score.season === season.season);
    const missingKeys = [...new Set(seasonScores.filter((score) => !registryKeys.has(score.player_key)).map((score) => score.player_key))];
    if (missingKeys.length) throw new Error(`${season.season}: score evidence lacks canonical registry metadata for ${missingKeys.slice(0, 10).join(", ")}`);
    await runTransaction(sql, [
      ...historicalPlayerRegistryStatements(registry),
      ...scoreStatements(seasonScores),
    ]);
  }
  // Reconcile existing sequence IDs and backfill exact postseason scoring.
  // The same normalizer and writers are used by the live weekly loader.
  const archives = new Map<number, URL>();
  for (const base of ['history', 'seasons']) {
    const dir = new URL(`data/${base}/`, root);
    if (!existsSync(dir)) continue;
    for (const year of readdirSync(dir).filter((n) => /^\d{4}$/.test(n))) archives.set(Number(year), new URL(`${year}/`, dir));
  }
  for (const [year, dir] of [...archives].sort((a, b) => a[0] - b[0])) {
    const box = new URL('boxscores/', dir);
    if (!existsSync(box)) continue;
    const league = JSON.parse(gunzipSync(readFileSync(new URL('league.json.gz', dir))).toString()) as EspnLeague;
    league.seasonId ??= year;
    const weeks = new Set(completedWeeks(league));
    const entries: ReturnType<typeof rosterEntryRows> = [];
    const profiles = new Map<number, ReturnType<typeof playerRows>[number]>();
    for (const filename of readdirSync(box).sort()) {
      const match = /^sp(\d+)\.json\.gz$/.exec(filename); if (!match || !weeks.has(Number(match[1]))) continue;
      const bx = JSON.parse(gunzipSync(readFileSync(new URL(filename, box))).toString()) as EspnLeague;
      bx.seasonId ??= year;
      entries.push(...rosterEntryRows(bx, Number(match[1]), starterSlots(league)));
      for (const p of playerRows(bx)) if (!profiles.has(p.espn_player_id)) profiles.set(p.espn_player_id, p);
    }
    const positions = new Map([...profiles.values()].filter((p) => p.default_position_id !== null)
      .map((p) => [p.espn_player_id, p.default_position_id!]));
    await runTransaction(sql, [
      ...tradeWriteStatements(year, detectTrades(year, entries, league.transactions ?? [])),
      ...scoreStatements(observedPlayerWeeks(entries, positions, digest(league.settings))),
      ...upsertChunked('public.player_season_profiles', ['season', 'espn_player_id', 'full_name', 'position_id', 'eligible_slots'],
        [...profiles.values()].map((p) => ({ season: year, espn_player_id: p.espn_player_id, full_name: p.full_name,
          position_id: p.default_position_id, eligible_slots: p.eligible_slots })), ['season', 'espn_player_id']),
    ]);
  }
  // Historical players missing from the final roster still need a display identity.
  const players = [...new Map(bases.flatMap((s) => s.picks).map((p) => [p.espn_player_id, {
    espn_player_id: p.espn_player_id, full_name: p.full_name, default_position_id: p.position,
  }])).values()];
  await runTransaction(sql, upsertChunked('public.players', ['espn_player_id', 'full_name', 'default_position_id'], players, ['espn_player_id'], []));

  // A reviewed draft identity is also a season-scoped provider alias. Insert any
  // missing aliases so raw draft-board/profile joins and the published grades use
  // the same canonical player. Existing aliases are never overwritten: a
  // disagreement is an evidence conflict and must stop the refresh for review.
  const draftAliases = [...new Map(bases.flatMap((season) => season.picks.map((pick) => {
    const player_key = canonicalPlayerKey(pick.espn_player_id);
    return [`${season.season}:${pick.espn_player_id}`, {
      season: season.season,
      espn_player_id: pick.espn_player_id,
      player_key,
      match_method: 'reviewed_draft_evidence',
    }] as const;
  }))).values()];
  if (draftAliases.some((alias) => alias.player_key.startsWith('espn:'))) {
    throw new Error('A complete draft season still contains a non-canonical offensive player identity');
  }
  const existingAliases = await query<{ season: number; espn_player_id: number; player_key: string }>(
    'select season, espn_player_id, player_key from public.nfl_player_aliases where season = any($1::int[])',
    [bases.map((season) => season.season)],
  );
  const expectedAliases = new Map(draftAliases.map((alias) => [`${alias.season}:${alias.espn_player_id}`, alias.player_key]));
  for (const alias of existingAliases) {
    const expected = expectedAliases.get(`${alias.season}:${alias.espn_player_id}`);
    if (expected && expected !== alias.player_key) {
      throw new Error(`${alias.season} ESPN player ${alias.espn_player_id}: existing alias ${alias.player_key} conflicts with reviewed draft identity ${expected}`);
    }
  }
  await runTransaction(sql, upsertChunked(
    'public.nfl_player_aliases',
    ['season', 'espn_player_id', 'player_key', 'match_method'],
    draftAliases,
    ['season', 'espn_player_id'],
    [],
  ));

  const [canonical, boards] = await Promise.all([
    query<PlayerWeekScore>('select * from public.player_week_scores where season = any($1::int[]) order by season, week, player_key', [bases.map((s) => s.season)]),
    query<(typeof archivedBoards)[number]>('select season, overall_pick, espn_team_id, espn_player_id from public.draft_picks order by season, overall_pick'),
  ]);
  const inputs = draftInputsFromScores(bases, canonical, boards);
  await runTransaction(sql, draftPublicationStatements(inputs.seasons, inputs.coverage));
  console.log('Draft coverage:', JSON.stringify(inputs.coverage));
  const seasons = await query<{ season: number }>('select distinct season from public.trades order by season');
  for (const { season } of seasons) {
    const [trades, moves, loaded] = await Promise.all([
      query<DetectedTrade & { revision_hash: string }>(`select season, trade_id, identity_key, effective_week, team_a, team_b,
        espn_transaction_id, accepted_at, confidence, revision_hash from public.trades
        where season = $1 and evidence_status = 'active' order by trade_id`, [season]),
      query<DetectedTrade['players'][number] & { trade_id: string }>('select trade_id, espn_player_id, from_team_id, to_team_id from public.trade_players where season = $1 order by trade_id, espn_player_id', [season]),
      loadTradeContext(query, season),
    ]);
    if (trades.some((t) => !t.revision_hash)) throw new Error(`${season}: run the trade reconciliation before publishing models`);
    const complete = trades.map((t) => ({ ...t, players: moves.filter((m) => m.trade_id === t.trade_id)
      .map(({ trade_id: _id, ...m }) => m) }));
    await runTransaction(sql, tradePublicationStatements(season, complete, loaded.context, loaded.fingerprintInput, loaded.evidence));
    console.log(`${season}: published ${trades.length} trade results`);
  }
} else {
  console.log(`Validated ${fileURLToPath(root)} without database writes`);
}
