#!/usr/bin/env node
/**
 * Build draft-performance rows for the legacy ESPN era (2008-2017).
 *
 * WHY THIS EXISTS
 * ESPN's legacy weekly matchup endpoint still gives us team scores, but its
 * old boxscore payloads no longer contain the player-level weekly lineups.
 * The authenticated season archive DOES preserve exact full-season fantasy
 * totals for players who survived on a final roster. That covers roughly 70%
 * of drafted offensive players, but using only those players would bias a
 * draft grade by preferentially dropping injuries, suspensions and outright
 * busts.
 *
 * For the missing players we reconstruct the season total from nflverse weekly
 * player stats under the scoring rules preserved in the Grudge archive. The
 * reconstruction was validated against 1,400+ archived ESPN QB/RB/WR/TE season
 * totals from 2008-2017: median absolute error is 0-1 point by season and mean
 * absolute error is about 1-2 points. Most residual error is the historical
 * +1 bonus for a 40+ yard touchdown, which the nflverse weekly aggregate does
 * not identify as a touchdown-specific long-play flag.
 *
 * Identity resolution order:
 *   1. exact ESPN player id -> DynastyProcess ESPN/GSIS crosswalk;
 *   2. unique normalized player-name + position match in that nflverse season;
 *   3. no nflverse regular-season stat row -> zero points.
 *
 * The generated CSV is committed so the application never depends on a live
 * third-party download. Re-run this script only when rebuilding the archive.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'data', 'derived', 'legacy-draft-performance.csv');
const SEASONS = Array.from({ length: 10 }, (_, i) => 2008 + i);
const META_SEASONS = Array.from({ length: 13 }, (_, i) => 2005 + i);
const OFFENSE = new Map([[1, 'QB'], [2, 'RB'], [3, 'WR'], [4, 'TE']]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function fetchCsv(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Grudge historical archive builder' },
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return parseCsv(await response.text());
}

function leagueData(season) {
  const file = path.join(ROOT, 'data', 'history', String(season), 'league.json.gz');
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  return Array.isArray(raw) ? raw[0] : raw;
}

function normalizedName(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function number(row, key) {
  const n = Number(row[key] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function weeklyFantasyPoints(row, season) {
  const passingYards = number(row, 'passing_yards');
  const passingYardPoints = season <= 2008
    ? Math.floor(passingYards / 25)
    : season <= 2011
      ? Math.floor(passingYards / 5) * 0.2
      : season === 2012
        ? Math.floor(passingYards / 100) * 2.86
        : Math.floor(passingYards / 100) * 2.85;

  const rushingYards = number(row, 'rushing_yards');
  const rushingYardPoints = season <= 2008
    ? Math.floor(rushingYards / 10)
    : rushingYards * 0.1;

  const receivingYards = number(row, 'receiving_yards');
  const receivingYardPoints = season <= 2008
    ? Math.floor(receivingYards / 10)
    : receivingYards * 0.1;

  return passingYardPoints
    + number(row, 'passing_tds') * (season === 2017 ? 4 : 5)
    + number(row, 'passing_interceptions') * (season === 2017 ? -3 : -2)
    + number(row, 'passing_2pt_conversions') * 2
    + rushingYardPoints
    + number(row, 'rushing_tds') * 6
    + number(row, 'rushing_2pt_conversions') * 2
    + receivingYardPoints
    + number(row, 'receiving_tds') * 6
    + number(row, 'receiving_2pt_conversions') * 2
    + number(row, 'receptions') * (season >= 2012 ? 0.2 : 0)
    + number(row, 'fumbles_lost_total') * -2
    + number(row, 'fumble_recovery_tds') * 6
    + number(row, 'special_teams_tds') * 6;
}

function exactEspnTotals(data, season) {
  const out = new Map();
  for (const team of data?.teams ?? []) {
    for (const entry of team?.roster?.entries ?? []) {
      const player = entry?.playerPoolEntry?.player;
      if (!player?.id) continue;
      const stat = (player.stats ?? []).find((row) =>
        Number(row.seasonId) === season
        && Number(row.statSourceId) === 0
        && Number(row.statSplitTypeId) === 0
        && row.appliedTotal !== undefined
        && row.appliedTotal !== null);
      if (stat) out.set(Number(player.id), Number(stat.appliedTotal));
    }
  }
  return out;
}

const metadata = new Map();
const dataBySeason = new Map();
for (const season of META_SEASONS) {
  const data = leagueData(season);
  dataBySeason.set(season, data);
  for (const team of data?.teams ?? []) {
    for (const entry of team?.roster?.entries ?? []) {
      const player = entry?.playerPoolEntry?.player;
      if (!player?.id) continue;
      metadata.set(Number(player.id), {
        name: player.fullName ?? null,
        positionId: player.defaultPositionId == null ? null : Number(player.defaultPositionId),
      });
    }
  }
}

const crosswalkRows = await fetchCsv(
  'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
);
const espnToGsis = new Map();
for (const row of crosswalkRows) {
  const espn = Number(row.espn_id);
  const gsis = String(row.gsis_id ?? '').trim();
  if (Number.isFinite(espn) && gsis) espnToGsis.set(espn, gsis);
}

const output = [];
for (const season of SEASONS) {
  const stats = await fetchCsv(
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`
  );
  const totals = new Map();
  const gsisMeta = new Map();
  const byNamePosition = new Map();

  for (const row of stats) {
    const gsis = String(row.player_id ?? '').trim();
    const rawPosition = String(row.position ?? '').trim();
    const position = rawPosition === 'FB' ? 'RB' : rawPosition;
    if (!gsis || !['QB', 'RB', 'WR', 'TE'].includes(position)) continue;
    const name = String(row.player_display_name ?? '').trim();
    gsisMeta.set(gsis, { name, position });
    const key = `${normalizedName(name)}:${position}`;
    const matches = byNamePosition.get(key) ?? new Set();
    matches.add(gsis);
    byNamePosition.set(key, matches);
    if (row.season_type === 'REG') {
      totals.set(gsis, (totals.get(gsis) ?? 0) + weeklyFantasyPoints(row, season));
    }
  }

  const data = dataBySeason.get(season);
  const exact = exactEspnTotals(data, season);
  const picks = data?.draftDetail?.picks ?? [];
  let offensivePicks = 0;

  for (const pick of picks) {
    const playerId = Number(pick.playerId);
    const meta = metadata.get(playerId);
    const position = OFFENSE.get(meta?.positionId);
    if (!position) continue;
    offensivePicks += 1;

    let points;
    let source;
    let sourcePlayerId = '';

    if (exact.has(playerId)) {
      points = exact.get(playerId);
      source = 'espn_exact';
    } else {
      const crossed = espnToGsis.get(playerId);
      if (crossed && totals.has(crossed)) {
        points = totals.get(crossed);
        source = 'nflverse_id';
        sourcePlayerId = crossed;
      } else {
        const key = `${normalizedName(meta?.name)}:${position}`;
        const matches = [...(byNamePosition.get(key) ?? [])].filter((id) => totals.has(id));
        if (matches.length === 1) {
          sourcePlayerId = matches[0];
          points = totals.get(sourcePlayerId);
          source = 'nflverse_name';
        } else if (matches.length === 0) {
          // No regular-season stat row under this player's name/position. The
          // known cases are missed seasons / retired or suspended players (for
          // example Andrew Luck 2017, Josh Gordon 2016 and Ray Rice 2014).
          points = 0;
          source = 'no_regular_season_stats';
        } else {
          throw new Error(
            `${season} ESPN player ${playerId} ${meta?.name}: ambiguous nflverse name/position match`
          );
        }
      }
    }

    output.push({
      season,
      espn_player_id: playerId,
      full_name: meta?.name ?? '',
      default_position_id: meta?.positionId ?? '',
      fantasy_points: Number(points).toFixed(2),
      source,
      source_player_id: sourcePlayerId,
    });
  }

  const seasonRows = output.filter((row) => row.season === season);
  if (seasonRows.length !== offensivePicks || offensivePicks < 120) {
    throw new Error(`${season}: expected a complete offensive draft board, got ${seasonRows.length}/${offensivePicks}`);
  }
  const sources = Object.groupBy(seasonRows, (row) => row.source);
  console.log(
    `${season}: ${seasonRows.length} offensive picks — `
    + Object.entries(sources).map(([key, rows]) => `${key}=${rows.length}`).join(', ')
  );
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const headers = [
  'season', 'espn_player_id', 'full_name', 'default_position_id',
  'fantasy_points', 'source', 'source_player_id',
];
const csv = [
  headers.join(','),
  ...output
    .sort((a, b) => a.season - b.season || a.espn_player_id - b.espn_player_id)
    .map((row) => headers.map((header) => csvCell(row[header])).join(',')),
].join('\n') + '\n';
fs.writeFileSync(OUT, csv);
console.log(`Wrote ${output.length} rows to ${path.relative(ROOT, OUT)}`);
