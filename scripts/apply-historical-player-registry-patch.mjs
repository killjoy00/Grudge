#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const original = readFileSync(path, 'utf8');
  const count = original.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one target block, found ${count}`);
  writeFileSync(path, original.replace(before, after));
}

replaceOnce('pipeline/draft-model.ts',
`  /** All NFL offensive players, including undrafted/free-agent production. */\n  pool: [string, number, number][];\n  picks: DraftPerformancePick[];\n`,
`  /** All NFL offensive players, including undrafted/free-agent production. */\n  pool: [string, number, number][];\n  /** Canonical identity metadata for every player whose production enters the historical pool. */\n  player_registry?: [string, number, string][];\n  picks: DraftPerformancePick[];\n`);

replaceOnce('scripts/build-draft-performance.py',
`        seasons.append({'season': year, 'regular_weeks': regular, 'team_count': len(data['teams']),\n                        'total_picks': max_pick,\n                        'board': [[p['overallPickNumber'], p['teamId'], p['playerId']] for p in picks],\n                        'excluded_board': excluded_board,\n                        'slot_counts': data['settings']['rosterSettings']['lineupSlotCounts'],\n                        'pool': pool, 'picks': results})\n`,
`        seasons.append({'season': year, 'regular_weeks': regular, 'team_count': len(data['teams']),\n                        'total_picks': max_pick,\n                        'board': [[p['overallPickNumber'], p['teamId'], p['playerId']] for p in picks],\n                        'excluded_board': excluded_board,\n                        'slot_counts': data['settings']['rosterSettings']['lineupSlotCounts'],\n                        'pool': pool,\n                        'player_registry': [[gsis, info['position'], info['name']] for gsis, info in sorted(pool_meta.items())],\n                        'picks': results})\n`);

const playerImportPath = 'pipeline/player-import.ts';
let playerImport = readFileSync(playerImportPath, 'utf8');
if (playerImport.includes('historicalPlayerRegistryStatements')) throw new Error('historical registry helper already exists');
playerImport += `\n\n/**\n * Seed canonical identities required by reproducible historical scoring.\n * This is intentionally insert-only: the modern player pipeline may already\n * have a richer name, position, or bio and historical evidence must not erase it.\n */\nexport function historicalPlayerRegistryStatements(players: PlayerProfile[]): Stmt[] {\n  const statements: Stmt[] = [];\n  for (let i = 0; i < players.length; i += 500) statements.push(stmt(\`\n    insert into public.nfl_players (player_key, full_name, position, bio)\n    select player_key, full_name, position, bio from jsonb_to_recordset($1::jsonb)\n      as x(player_key text, full_name text, position text, bio jsonb)\n    on conflict (player_key) do nothing\`, [JSON.stringify(players.slice(i, i + 500))]));\n  return statements;\n}\n`;
writeFileSync(playerImportPath, playerImport);

replaceOnce('scripts/refresh-model-results.ts',
`import type { EspnLeague } from '../pipeline/espn.ts';\n`,
`import type { EspnLeague } from '../pipeline/espn.ts';\nimport { historicalPlayerRegistryStatements } from '../pipeline/player-import.ts';\n`);

replaceOnce('scripts/refresh-model-results.ts',
`  for (const season of data.seasons) {\n    await runTransaction(sql, scoreStatements(scores.filter((s) => s.season === season.season)));\n  }\n`,
`  const positionNames = new Map([[1, 'QB'], [2, 'RB'], [3, 'WR'], [4, 'TE']]);\n  for (const season of data.seasons) {\n    const base = bases.find((candidate) => candidate.season === season.season);\n    if (!base?.player_registry?.length) throw new Error(\`${'${season.season}'}: missing historical player registry evidence\`);\n    const registry = base.player_registry.map(([gsis, positionId, fullName]) => {\n      const position = positionNames.get(positionId);\n      if (!position || !fullName) throw new Error(\`${'${season.season}'}: invalid historical player registry row ${'${gsis}'}\`);\n      return { player_key: \`gsis:${'${gsis}'}\`, full_name: fullName, position, bio: {} };\n    });\n    const registryKeys = new Set(registry.map((player) => player.player_key));\n    const seasonScores = scores.filter((score) => score.season === season.season);\n    const missingKeys = [...new Set(seasonScores.filter((score) => !registryKeys.has(score.player_key)).map((score) => score.player_key))];\n    if (missingKeys.length) throw new Error(\`${'${season.season}'}: score evidence lacks canonical registry metadata for ${'${missingKeys.slice(0, 10).join(", ")}'}\`);\n    await runTransaction(sql, [\n      ...historicalPlayerRegistryStatements(registry),\n      ...scoreStatements(seasonScores),\n    ]);\n  }\n`);

console.log('Applied historical player registry patch');
