/**
 * Turns an archived ESPN `league.json` into the same franchise/manager season
 * rows the 2005-2017 spreadsheet produces, so both eras land in one table.
 *
 * Nothing here is reconstructed. ESPN records the regular-season record, the
 * real playoff bracket, the final placement, and the owning accounts, so the
 * only judgement calls are the two identity maps this module takes as input:
 * which ESPN team id is which franchise, and which ESPN account is which
 * person.
 */

import type { ManualManagerSeason, ManualSeasonResult } from './manual-history.ts';

export interface EspnRecord {
  wins: number; losses: number; ties: number;
  pointsFor: number; pointsAgainst: number;
}

export interface EspnTeam {
  id: number;
  name: string;
  owners?: string[];
  primaryOwner?: string;
  playoffSeed?: number;
  rankCalculatedFinal?: number;
  record?: { overall?: Partial<EspnRecord> };
}

export interface EspnMatchup {
  matchupPeriodId?: number;
  playoffTierType?: string;
  winner?: string;
  home?: { teamId?: number };
  away?: { teamId?: number };
}

export interface EspnLeague {
  seasonId?: number;
  teams?: EspnTeam[];
  schedule?: EspnMatchup[];
  members?: { id: string; firstName?: string; lastName?: string; displayName?: string }[];
  settings?: { scheduleSettings?: { matchupPeriodCount?: number } };
}

export interface FranchiseIdMapping {
  franchise_key: string;
  espn_team_id: number;
  start_season: number;
  end_season: number | null;
}

/** The championship bracket. Consolation ladders decide placement, not titles. */
const TITLE_BRACKET = 'WINNERS_BRACKET';

function overall(team: EspnTeam): EspnRecord {
  const record = team.record?.overall ?? {};
  return {
    wins: record.wins ?? 0,
    losses: record.losses ?? 0,
    ties: record.ties ?? 0,
    pointsFor: record.pointsFor ?? 0,
    pointsAgainst: record.pointsAgainst ?? 0,
  };
}

/** A season ESPN created but the league never played -- 2020 -- has no games. */
export function wasPlayed(league: EspnLeague): boolean {
  return (league.teams ?? []).some((team) => {
    const record = overall(team);
    return record.wins + record.losses + record.ties > 0;
  });
}

export function franchiseForTeam(
  mappings: FranchiseIdMapping[], espnTeamId: number, season: number
): string {
  const matches = mappings.filter(
    (row) => row.espn_team_id === espnTeamId &&
      season >= row.start_season && season <= (row.end_season ?? Infinity)
  );
  if (matches.length === 0) {
    throw new Error(`${season}: ESPN team ${espnTeamId} maps to no franchise.`);
  }
  if (matches.length > 1) {
    throw new Error(`${season}: ESPN team ${espnTeamId} maps to ${matches.length} franchises.`);
  }
  return matches[0]!.franchise_key;
}

/**
 * Playoff records straight from the bracket. A bye is stored as a matchup with
 * no opponent, so it is skipped rather than counted as a win.
 */
function playoffRecords(league: EspnLeague, season: number) {
  const wins = new Map<number, number>();
  const losses = new Map<number, number>();
  let title: { week: number; winner: number } | null = null;

  for (const matchup of league.schedule ?? []) {
    if (matchup.playoffTierType !== TITLE_BRACKET) continue;
    const home = matchup.home?.teamId;
    const away = matchup.away?.teamId;
    if (home === undefined || away === undefined) continue;

    if (matchup.winner !== 'HOME' && matchup.winner !== 'AWAY') {
      throw new Error(
        `${season}: playoff game ${home} vs ${away} ended '${matchup.winner}'; ` +
        'the archive cannot say who advanced.'
      );
    }
    const winner = matchup.winner === 'HOME' ? home : away;
    const loser = matchup.winner === 'HOME' ? away : home;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
    losses.set(loser, (losses.get(loser) ?? 0) + 1);

    const week = matchup.matchupPeriodId ?? 0;
    if (!title || week > title.week) title = { week, winner };
  }
  return { wins, losses, champion: title?.winner ?? null };
}

export function espnSeasonResults(
  league: EspnLeague, season: number, mappings: FranchiseIdMapping[]
): ManualSeasonResult[] {
  const teams = league.teams ?? [];
  if (teams.length === 0) throw new Error(`${season}: the archive has no teams.`);
  const scheduled = league.settings?.scheduleSettings?.matchupPeriodCount ?? null;
  const { wins, losses, champion } = playoffRecords(league, season);

  const places = teams.map((team) => team.rankCalculatedFinal ?? 0);
  const ranked = [...places].sort((a, b) => a - b);
  const complete = ranked.every((place, index) => place === index + 1);
  if (!complete) {
    throw new Error(`${season}: final placements are not 1..${teams.length}: ${ranked.join(',')}.`);
  }
  if (champion !== null) {
    const titled = teams.find((team) => team.rankCalculatedFinal === 1);
    if (titled?.id !== champion) {
      throw new Error(
        `${season}: team ${champion} won the final but team ${titled?.id} is ranked first.`
      );
    }
  }

  return teams.map((team) => {
    const record = overall(team);
    const played = record.wins + record.losses + record.ties;
    if (scheduled !== null && played !== scheduled) {
      throw new Error(
        `${season}: ${team.name} played ${played} regular-season games, not ${scheduled}.`
      );
    }
    const place = team.rankCalculatedFinal!;
    return {
      season,
      franchise_key: franchiseForTeam(mappings, team.id, season),
      team_name: team.name,
      regular_wins: record.wins,
      regular_losses: record.losses,
      regular_ties: record.ties,
      regular_points_for: Number(record.pointsFor.toFixed(2)),
      regular_points_against: Number(record.pointsAgainst.toFixed(2)),
      playoff_wins: wins.get(team.id) ?? 0,
      playoff_losses: losses.get(team.id) ?? 0,
      final_place: place,
      is_champion: place === 1,
      is_runner_up: place === 2,
      espn_team_id: team.id,
      source: 'espn',
      source_note: `ESPN league archive; ${team.playoffSeed ? `${team.playoffSeed} seed, ` : ''}` +
        'record and bracket as ESPN reported them',
    };
  });
}

/**
 * Who ran each team, from the accounts ESPN has on the roster. `primaryOwner`
 * settles co-ownership; every listed owner still gets the season on their
 * record.
 */
export function espnManagerSeasons(
  league: EspnLeague, season: number, mappings: FranchiseIdMapping[],
  managerBySwid: Map<string, string | null>
): ManualManagerSeason[] {
  const rows: ManualManagerSeason[] = [];
  for (const team of league.teams ?? []) {
    const owners = team.owners ?? [];
    if (owners.length === 0) throw new Error(`${season}: ${team.name} has no owner on file.`);
    const franchise_key = franchiseForTeam(mappings, team.id, season);
    for (const swid of owners) {
      if (!managerBySwid.has(swid)) {
        throw new Error(`${season}: ESPN account ${swid} (${team.name}) maps to no manager.`);
      }
      const manager_key = managerBySwid.get(swid);
      // A blank mapping is an account the league does not credit as a manager.
      if (!manager_key) continue;
      rows.push({
        season,
        manager_key,
        franchise_key,
        is_primary: owners.length === 1 || swid === team.primaryOwner,
      });
    }
    const primaries = rows.filter(
      (row) => row.season === season && row.franchise_key === franchise_key && row.is_primary
    );
    if (primaries.length !== 1) {
      throw new Error(
        `${season}: ${team.name} has ${primaries.length} primary owners; ` +
        'ESPN primaryOwner does not name one of the listed owners.'
      );
    }
  }
  return rows;
}
