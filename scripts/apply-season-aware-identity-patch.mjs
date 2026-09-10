#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const text = readFileSync(path, 'utf8');
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one match, found ${count}`);
  writeFileSync(path, text.replace(before, after));
}

replaceOnce('scripts/build-draft-performance.py',
`    overrides = ROOT / 'data/draft-player-identities.json'\n    for row in json.loads(overrides.read_text())['players']:\n        by_espn[row['espn_id']] = row\n    excluded_overrides_path = ROOT / 'data/draft-excluded-pick-overrides.json'\n`,
`    overrides = ROOT / 'data/draft-player-identities.json'\n    for row in json.loads(overrides.read_text())['players']:\n        by_espn[row['espn_id']] = row\n    season_overrides_path = ROOT / 'data/draft-player-season-identities.json'\n    season_override_data = json.loads(season_overrides_path.read_text())\n    if season_override_data.get('schema_version') != 1:\n        raise ValueError('Unsupported season-scoped draft identity override schema')\n    season_overrides = {(row['season'], row['espn_id']): row for row in season_override_data.get('players', [])}\n    if len(season_overrides) != len(season_override_data.get('players', [])):\n        raise ValueError('Duplicate season-scoped draft identity override')\n    excluded_overrides_path = ROOT / 'data/draft-excluded-pick-overrides.json'\n`);

replaceOnce('scripts/build-draft-performance.py',
`        id_map = {}\n        for player_id, info in by_espn.items():\n            if info['gsis_id'] not in ('NA', ''):\n                id_map[player_id] = info['gsis_id']\n\n        def resolve(player_id, name, pos):\n`,
`        id_map = {}\n        for player_id, info in by_espn.items():\n            if info['gsis_id'] not in ('NA', ''):\n                id_map[player_id] = info['gsis_id']\n        for (override_year, player_id), info in season_overrides.items():\n            if override_year == year:\n                id_map[player_id] = info['gsis_id']\n\n        def resolve(player_id, name, pos):\n`);

replaceOnce('scripts/build-draft-performance.py',
`            crossed = by_espn.get(player_id, {})\n            pos = info.get('defaultPositionId') or POSITIONS.get(crossed.get('position'))\n`,
`            crossed = season_overrides.get((year, player_id), by_espn.get(player_id, {}))\n            if (year, player_id) in season_overrides and info.get('fullName'):\n                if normalized(info['fullName']) != normalized(crossed['name']):\n                    raise ValueError(f'{year}: season identity override name mismatch for ESPN {player_id}')\n                if info.get('defaultPositionId') and POSITIONS.get(crossed['position']) != info.get('defaultPositionId'):\n                    raise ValueError(f'{year}: season identity override position mismatch for ESPN {player_id}')\n            pos = info.get('defaultPositionId') or POSITIONS.get(crossed.get('position'))\n`);

replaceOnce('scripts/build-draft-performance.py',
`            results.append({'overall_pick': pick['overallPickNumber'], 'espn_team_id': pick['teamId'],\n                            'espn_player_id': player_id, 'full_name': name, 'position': pos,\n                            'fantasy_points': round(sum(values), 2),\n`,
`            results.append({'overall_pick': pick['overallPickNumber'], 'espn_team_id': pick['teamId'],\n                            'espn_player_id': player_id, 'player_key': f'gsis:{gsis}',\n                            'full_name': name, 'position': pos,\n                            'fantasy_points': round(sum(values), 2),\n`);

replaceOnce('scripts/build-draft-performance.py',
`        all_identities.update(id_map)\n        print(f'{year}: {len(results)} offensive picks, {len(pool)} NFL players, {len(errors)} scoring comparisons', flush=True)\n`,
`        all_identities.update({player_id: gsis for player_id, gsis in id_map.items()\n                               if (year, player_id) not in season_overrides})\n        print(f'{year}: {len(results)} offensive picks, {len(pool)} NFL players, {len(errors)} scoring comparisons', flush=True)\n`);

replaceOnce('scripts/build-draft-performance.py',
`        'identity_overrides_sha256': hashlib.sha256(overrides.read_bytes()).hexdigest(),\n        'excluded_pick_overrides_sha256': hashlib.sha256(excluded_overrides_path.read_bytes()).hexdigest(),\n`,
`        'identity_overrides_sha256': hashlib.sha256(overrides.read_bytes()).hexdigest(),\n        'season_identity_overrides_sha256': hashlib.sha256(season_overrides_path.read_bytes()).hexdigest(),\n        'excluded_pick_overrides_sha256': hashlib.sha256(excluded_overrides_path.read_bytes()).hexdigest(),\n`);

replaceOnce('pipeline/draft-model.ts',
`  espn_player_id: number;\n  full_name: string;\n`,
`  espn_player_id: number;\n  player_key: string;\n  full_name: string;\n`);

replaceOnce('pipeline/model-publish.ts',
`import { canonicalPlayerKey, digest, type PlayerWeekScore } from './player-week.ts';\n`,
`import { digest, type PlayerWeekScore } from './player-week.ts';\n`);
replaceOnce('pipeline/model-publish.ts',
`      const rows = production(canonicalPlayerKey(pick.espn_player_id));\n`,
`      const rows = production(pick.player_key);\n`);
replaceOnce('pipeline/model-publish.ts',
`  const grades = gradeDrafts(seasons).map((grade) => ({\n    ...grade,\n    player_key: canonicalPlayerKey(grade.espn_player_id),\n  }));\n`,
`  const grades = gradeDrafts(seasons);\n`);

replaceOnce('pipeline/player-week.ts',
`import identities from '../data/derived/player-identities.json' with { type: 'json' };\n`,
`import identities from '../data/derived/player-identities.json' with { type: 'json' };\nimport seasonIdentities from '../data/draft-player-season-identities.json' with { type: 'json' };\n`);
replaceOnce('pipeline/player-week.ts',
`export function canonicalPlayerKey(id: number): string {\n`,
`const seasonIdentityMap = new Map(\n  (seasonIdentities.players as { season: number; espn_id: number; gsis_id: string }[])\n    .map((row) => [\`${'${row.season}:${row.espn_id}'}\`, row.gsis_id]),\n);\n\nexport function canonicalPlayerKey(id: number, season?: number): string {\n`);
replaceOnce('pipeline/player-week.ts',
`  const gsis = (identities as Record<string, string>)[String(id)];\n`,
`  const gsis = (season === undefined ? undefined : seasonIdentityMap.get(\`${'${season}:${id}'}\`))\n    ?? (identities as Record<string, string>)[String(id)];\n`);
replaceOnce('pipeline/player-week.ts',
`      season: row.season, week: row.week, player_key: canonicalPlayerKey(row.espn_player_id),\n`,
`      season: row.season, week: row.week, player_key: canonicalPlayerKey(row.espn_player_id, row.season),\n`);

const pwPath = 'pipeline/player-week.ts';
let pw = readFileSync(pwPath, 'utf8');
if (pw.includes('replaceHistoricalScoreStatements')) throw new Error('replaceHistoricalScoreStatements already exists');
pw += `\n\n/** Replace only the reproducible historical regular-season layer for one season. */\nexport function replaceHistoricalScoreStatements(season: number, rows: PlayerWeekScore[]): Stmt[] {\n  if (rows.some((row) => row.season !== season || !['historical_espn', 'nflverse'].includes(row.source))) {\n    throw new Error(\`Invalid historical score replacement for ${'${season}'}\`);\n  }\n  return [\n    stmt(\`delete from public.player_week_scores where season = $1 and source in ('historical_espn', 'nflverse')\`, [season]),\n    ...scoreStatements(rows),\n  ];\n}\n`;
writeFileSync(pwPath, pw);

replaceOnce('scripts/refresh-model-results.ts',
`import { canonicalPlayerKey, digest, observedPlayerWeeks, scoreStatements, type PlayerWeekScore, type ScoringEvidence } from '../pipeline/player-week.ts';\n`,
`import { digest, observedPlayerWeeks, replaceHistoricalScoreStatements, scoreStatements, type PlayerWeekScore, type ScoringEvidence } from '../pipeline/player-week.ts';\n`);

replaceOnce('scripts/refresh-model-results.ts',
`  const positionNames = new Map([[1, 'QB'], [2, 'RB'], [3, 'WR'], [4, 'TE']]);\n  for (const season of data.seasons) {\n`,
`  const positionNames = new Map([[1, 'QB'], [2, 'RB'], [3, 'WR'], [4, 'TE']]);\n  // Preflight season-scoped aliases before any production write. A provider-ID\n  // collision must stop the refresh without leaving partially replaced scores.\n  const draftAliases = [...new Map(bases.flatMap((season) => season.picks.map((pick) => [\n    \`${'${season.season}:${pick.espn_player_id}'}\`,\n    { season: season.season, espn_player_id: pick.espn_player_id, player_key: pick.player_key, match_method: 'reviewed_draft_evidence' },\n  ] as const))).values()];\n  if (draftAliases.some((alias) => !alias.player_key.startsWith('gsis:'))) {\n    throw new Error('A complete draft season still contains a non-canonical offensive player identity');\n  }\n  const existingAliases = await query<{ season: number; espn_player_id: number; player_key: string }>(\n    'select season, espn_player_id, player_key from public.nfl_player_aliases where season = any($1::int[])',\n    [bases.map((season) => season.season)],\n  );\n  const expectedAliases = new Map(draftAliases.map((alias) => [\`${'${alias.season}:${alias.espn_player_id}'}\`, alias.player_key]));\n  for (const alias of existingAliases) {\n    const expected = expectedAliases.get(\`${'${alias.season}:${alias.espn_player_id}'}\`);\n    if (expected && expected !== alias.player_key) {\n      throw new Error(\`${'${alias.season}'} ESPN player ${'${alias.espn_player_id}'}: existing alias ${'${alias.player_key}'} conflicts with reviewed draft identity ${'${expected}'}\`);\n    }\n  }\n  for (const season of data.seasons) {\n`);

replaceOnce('scripts/refresh-model-results.ts',
`    await runTransaction(sql, [\n      ...historicalPlayerRegistryStatements(registry),\n      ...scoreStatements(seasonScores),\n    ]);\n`,
`    await runTransaction(sql, [\n      ...historicalPlayerRegistryStatements(registry),\n      ...replaceHistoricalScoreStatements(season.season, seasonScores),\n    ]);\n`);

replaceOnce('scripts/refresh-model-results.ts',
`  // A reviewed draft identity is also a season-scoped provider alias. Insert any\n  // missing aliases so raw draft-board/profile joins and the published grades use\n  // the same canonical player. Existing aliases are never overwritten: a\n  // disagreement is an evidence conflict and must stop the refresh for review.\n  const draftAliases = [...new Map(bases.flatMap((season) => season.picks.map((pick) => {\n    const player_key = canonicalPlayerKey(pick.espn_player_id);\n    return [\`${'${season.season}:${pick.espn_player_id}'}\`, {\n      season: season.season,\n      espn_player_id: pick.espn_player_id,\n      player_key,\n      match_method: 'reviewed_draft_evidence',\n    }] as const;\n  }))).values()];\n  if (draftAliases.some((alias) => alias.player_key.startsWith('espn:'))) {\n    throw new Error('A complete draft season still contains a non-canonical offensive player identity');\n  }\n  const existingAliases = await query<{ season: number; espn_player_id: number; player_key: string }>(\n    'select season, espn_player_id, player_key from public.nfl_player_aliases where season = any($1::int[])',\n    [bases.map((season) => season.season)],\n  );\n  const expectedAliases = new Map(draftAliases.map((alias) => [\`${'${alias.season}:${alias.espn_player_id}'}\`, alias.player_key]));\n  for (const alias of existingAliases) {\n    const expected = expectedAliases.get(\`${'${alias.season}:${alias.espn_player_id}'}\`);\n    if (expected && expected !== alias.player_key) {\n      throw new Error(\`${'${alias.season}'} ESPN player ${'${alias.espn_player_id}'}: existing alias ${'${alias.player_key}'} conflicts with reviewed draft identity ${'${expected}'}\`);\n    }\n  }\n  await runTransaction(sql, upsertChunked(\n`,
`  // Insert only aliases that passed the preflight above.\n  await runTransaction(sql, upsertChunked(\n`);

replaceOnce('pipeline/player-week-canonical.test.ts',
`test('unknown non-defense ESPN ids remain explicit provider placeholders', () => {\n  assert.equal(canonicalPlayerKey(-42), 'espn:-42');\n});\n`,
`test('unknown non-defense ESPN ids remain explicit provider placeholders', () => {\n  assert.equal(canonicalPlayerKey(-42), 'espn:-42');\n});\n\ntest('historical provider-ID collisions resolve by season before the global crosswalk', () => {\n  assert.equal(canonicalPlayerKey(13103), 'gsis:00-0026857');\n  assert.equal(canonicalPlayerKey(13103, 2005), 'gsis:00-0020514');\n});\n`);

replaceOnce('pipeline/historical-player-registry.test.ts',
`import { scoreStatements, type PlayerWeekScore } from './player-week.ts';\n`,
`import { replaceHistoricalScoreStatements, scoreStatements, type PlayerWeekScore } from './player-week.ts';\n`);

let hist = readFileSync('pipeline/historical-player-registry.test.ts', 'utf8');
hist += `\n\ntest('historical score replacement removes superseded derived identities', async () => {\n  const db = await modelDatabase();\n  try {\n    const wrong = 'gsis:00-0026857';\n    const correct = 'gsis:00-0020514';\n    await db.query(\`insert into nfl_players(player_key,full_name,position,bio) values\n      ($1,'Dannell Ellerbe','LB','{}'),($2,'Michael Bennett','RB','{}')\`, [wrong, correct]);\n    await db.query(\`insert into player_week_scores\n      (season,week,player_key,espn_player_id,position_id,points,evidence,source,scoring_version,input_hash)\n      values(2005,1,$1,13103,2,0,'verified_zero','nflverse','old','old')\`, [wrong]);\n    const replacement: PlayerWeekScore = { season: 2005, week: 1, player_key: correct, espn_player_id: 13103,\n      position_id: 2, points: 4.5, evidence: 'reconstructed', source: 'nflverse', scoring_version: 'new', input_hash: 'new' };\n    await execute(db, replaceHistoricalScoreStatements(2005, [replacement]));\n    assert.equal((await db.query('select 1 from player_week_scores where season=2005 and player_key=$1', [wrong])).rows.length, 0);\n    const row = (await db.query<{points:string}>('select points from player_week_scores where season=2005 and player_key=$1', [correct])).rows[0];\n    assert.equal(Number(row?.points), 4.5);\n  } finally {\n    await db.close();\n  }\n});\n`;
writeFileSync('pipeline/historical-player-registry.test.ts', hist);

replaceOnce('pipeline/model-publish.test.ts',
`      espn_player_id: 8417,\n      full_name: 'Ronnie Brown',\n`,
`      espn_player_id: 8417,\n      player_key: canonicalPlayerKey(8417),\n      full_name: 'Ronnie Brown',\n`);

let mpt = readFileSync('pipeline/model-publish.test.ts', 'utf8');
mpt += `\n\ntest('draft publication trusts the committed season-scoped key over a colliding global ESPN id', async () => {\n  const db = await modelDatabase();\n  try {\n    const playerKey = 'gsis:00-0020514';\n    assert.equal(canonicalPlayerKey(13103), 'gsis:00-0026857');\n    await db.query(\`insert into nfl_players(player_key,full_name,position,bio) values($1,'Michael Bennett','RB','{}')\`, [playerKey]);\n    const seasons = [2005, 2007, 2008, 2009].map((season, index) => ({\n      ...syntheticSeason(season, 150 + index * 10),\n      board: [[1, 1, 13103]] as [number, number, number][],\n      picks: [{ ...syntheticSeason(season, 150 + index * 10).picks[0]!, espn_player_id: 13103, player_key, full_name: 'Michael Bennett' }],\n    }));\n    const coverage = Object.fromEntries(seasons.map(({ season }) => [season, { ready: true, reasons: [], source_hash: String(season) }]));\n    await execute(db, draftPublicationStatements(seasons, coverage));\n    const keys = (await db.query<{player_key:string}>(\`select player_key from draft_grade_results order by season\`)).rows.map((row) => row.player_key);\n    assert.deepEqual(keys, Array(4).fill(playerKey));\n  } finally { await db.close(); }\n});\n`;
writeFileSync('pipeline/model-publish.test.ts', mpt);

console.log('Applied season-aware historical identity patch');
