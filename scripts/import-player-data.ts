import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { connect, runTransaction } from '../pipeline/db.ts';
import { playerRegistryStatements, playerSeasonStatements, validatePlayerSeason, type PlayerSeasonArtifact } from '../pipeline/player-import.ts';
import type { PlayerProfile } from '../lib/player-data.ts';

const root = new URL('../data/derived/players/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as {
  schema_version: number; registry_sha256: string;
  seasons: Record<string, {file: string; sha256: string; row_count: number}>;
};
if (manifest.schema_version !== 1) throw new Error('Unsupported player manifest');
function read(name: string, expected: string) {
  if (!/^(registry|\d{4})\.json\.gz$/.test(name)) throw new Error('Invalid artifact name');
  const bytes = readFileSync(new URL(name, root));
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Artifact checksum mismatch: ${name}`);
  return JSON.parse(gunzipSync(bytes).toString());
}
const registry = read('registry.json.gz', manifest.registry_sha256) as {players: PlayerProfile[]};
const available = new Set(registry.players.map(p => p.player_key));
// Validate the complete batch before connecting or writing any season.
for (const [year, entry] of Object.entries(manifest.seasons)) {
  const s = read(entry.file, entry.sha256) as PlayerSeasonArtifact;
  validatePlayerSeason(s);
  if (s.season !== Number(year) || s.games.length !== entry.row_count || s.players.some(p => !available.has(p.player_key)))
    throw new Error(`Manifest/registry mismatch: ${year}`);
}
if (process.argv.includes('--dry-run')) {
  console.log(`Verified ${registry.players.length} identities and ${Object.keys(manifest.seasons).length} NFL seasons`);
} else {
  const sql = connect();
  await runTransaction(sql, playerRegistryStatements(registry.players));
  const old = await sql.query('select season, input_hash from public.nfl_player_imports') as {season: number; input_hash: string}[];
  for (const [year, entry] of Object.entries(manifest.seasons)) {
    if (!process.argv.includes('--force') && old.some(r => r.season === Number(year) && r.input_hash === entry.sha256)) continue;
    const s = read(entry.file, entry.sha256) as PlayerSeasonArtifact;
    await runTransaction(sql, playerSeasonStatements(s, entry.sha256));
    console.log(`${year}: published ${s.games.length} NFL player games`);
  }
}
