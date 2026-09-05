#!/usr/bin/env -S npx tsx
/**
 * Load draft boards stored inside data/history/<season>/league.json.gz.
 *
 * The normal weekly/history pipeline predates historical draft capture. This
 * companion import keeps that pipeline untouched while making every recovered
 * mDraftDetail board queryable through public.draft_picks.
 *
 * Historical mRoster payloads also retain names for many players. Those names
 * are inserted only when the player is not already in public.players: replaying
 * a 2008 archive must never overwrite a current player's modern team/position
 * metadata with an old one.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { connect, runTransaction, upsertChunked } from '../pipeline/db.ts';
import { draftPickRows } from '../pipeline/normalize.ts';
import type { EspnDraftDetail } from '../pipeline/espn.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY = join(ROOT, 'data', 'history');

type RawPlayer = {
  id?: number;
  fullName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
  eligibleSlots?: number[];
};

type RawLeague = EspnDraftDetail & {
  seasonId?: number;
  teams?: Array<{
    roster?: {
      entries?: Array<{
        playerPoolEntry?: { player?: RawPlayer };
      }>;
    };
  }>;
};

function readLeague(season: number): RawLeague | null {
  const path = join(HISTORY, String(season), 'league.json.gz');
  if (!existsSync(path)) return null;
  return JSON.parse(gunzipSync(readFileSync(path)).toString()) as RawLeague;
}

function rosterPlayers(league: RawLeague) {
  const byId = new Map<number, Record<string, unknown>>();
  for (const team of league.teams ?? []) {
    for (const entry of team.roster?.entries ?? []) {
      const player = entry.playerPoolEntry?.player;
      if (!player?.id || !player.fullName) continue;
      byId.set(player.id, {
        espn_player_id: player.id,
        full_name: player.fullName,
        default_position_id: player.defaultPositionId ?? null,
        pro_team_id: player.proTeamId ?? null,
        eligible_slots: player.eligibleSlots ?? null,
      });
    }
  }
  return [...byId.values()];
}

const seasons = existsSync(HISTORY)
  ? readdirSync(HISTORY).filter((name) => /^\d{4}$/.test(name)).map(Number).sort((a, b) => a - b)
  : [];

const sql = connect();
let totalPicks = 0;
let totalNamedPlayers = 0;

for (const season of seasons) {
  const league = readLeague(season);
  if (!league) continue;
  league.seasonId ??= season;

  const picks = draftPickRows(league, season);
  if (!picks.length) continue;
  const players = rosterPlayers(league);

  const statements = [
    // Empty updateColumns => ON CONFLICT DO NOTHING. Historical player metadata
    // is useful for names, but never gets to replace newer canonical metadata.
    ...upsertChunked(
      'public.players',
      ['espn_player_id', 'full_name', 'default_position_id', 'pro_team_id', 'eligible_slots'],
      players,
      ['espn_player_id'],
      []
    ),
    ...upsertChunked(
      'public.draft_picks',
      ['season', 'overall_pick', 'round', 'round_pick', 'espn_team_id', 'espn_player_id', 'is_keeper'],
      picks as unknown as Record<string, unknown>[],
      ['season', 'overall_pick']
    ),
  ];

  await runTransaction(sql, statements);
  totalPicks += picks.length;
  totalNamedPlayers += players.length;
  console.log(`${season}: draft picks=${picks.length}; roster player names=${players.length}`);
}

console.log(`Historical drafts imported: ${totalPicks} picks; ${totalNamedPlayers} season-roster player rows inspected.`);
