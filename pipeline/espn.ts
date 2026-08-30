/**
 * ESPN fantasy v3 client.
 *
 * Unauthenticated by design: the 2026 league is public, and keeping the weekly
 * pipeline cookie-free is why the historical backfill is a separate one-time
 * script (scripts/backfill-history.mjs) rather than part of this.
 *
 * Field semantics here are the ones confirmed in exploration/FINDINGS.md
 * against real payloads, not assumed from documentation -- ESPN publishes none.
 */

export const LEAGUE_ID = 114052;
const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';

const HEADERS = {
  accept: 'application/json',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class EspnError extends Error {
  constructor(message: string, readonly status: number, readonly url: string) {
    super(message);
    this.name = 'EspnError';
  }
}

/**
 * Fetch with bounded retries. Retries transport errors, 5xx and 429 only --
 * a 401 or 404 is a real answer about the data and retrying just hides it.
 */
async function fetchJson<T>(url: string, retries = 4): Promise<T> {
  let last = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: HEADERS });
      const text = await res.text();
      if (res.status >= 500 || res.status === 429) {
        last = `HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) throw new EspnError(text.slice(0, 200), res.status, url);
      return JSON.parse(text) as T;
    } catch (e) {
      if (e instanceof EspnError) throw e;
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new EspnError(`gave up after ${retries} retries: ${last}`, 0, url);
}

/* ------------------------------------------------------------------ shapes */
/* Only the fields the pipeline actually reads. Everything else survives in the
   raw JSON we archive, so a field we did not model is never lost. */

export interface EspnMember {
  id: string; // SWID, braces included -- store verbatim
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

export interface EspnTeam {
  id: number; // NOT contiguous: this league has no team 7
  name: string;
  abbrev?: string;
  logo?: string;
  divisionId?: number;
  primaryOwner?: string;
  owners?: string[];
  waiverRank?: number;
  transactionCounter?: { acquisitionBudgetSpent?: number };
  record?: {
    overall?: { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number };
  };
}

export interface EspnMatchupSide {
  teamId: number;
  totalPoints?: number;
  rosterForCurrentScoringPeriod?: { entries?: EspnRosterEntry[] };
}

export interface EspnMatchup {
  id: number;
  matchupPeriodId: number;
  winner?: string; // HOME | AWAY | TIE | UNDECIDED
  playoffTierType?: string | null;
  home?: EspnMatchupSide;
  away?: EspnMatchupSide;
}

export interface EspnRosterEntry {
  playerId: number;
  lineupSlotId: number;
  acquisitionType?: string;
  injuryStatus?: string;
  playerPoolEntry?: {
    appliedStatTotal?: number;
    player?: {
      id: number;
      fullName: string;
      defaultPositionId?: number;
      proTeamId?: number;
      stats?: { statSourceId: number; statSplitTypeId: number; scoringPeriodId: number; appliedTotal?: number }[];
    };
  };
}

export interface EspnTransactionItem {
  type?: string;
  playerId?: number;
  fromTeamId?: number; // 0 = free agent pool, not a real team
  toTeamId?: number;
  fromLineupSlotId?: number; // -1 = no prior slot
  toLineupSlotId?: number;
  overallPickNumber?: number;
  isKeeper?: boolean;
}

export interface EspnTransaction {
  id: string;
  type: string;
  status: string;
  executionType?: string;
  teamId?: number;
  scoringPeriodId: number;
  bidAmount?: number; // FAAB
  isPending?: boolean;
  proposedDate?: number;
  items?: EspnTransactionItem[];
}

export interface EspnLeague {
  id: number;
  seasonId: number;
  scoringPeriodId: number;
  status?: { currentMatchupPeriod?: number; latestScoringPeriod?: number; isActive?: boolean };
  members?: EspnMember[];
  teams?: EspnTeam[];
  schedule?: EspnMatchup[];
  transactions?: EspnTransaction[];
  settings?: {
    name: string;
    size: number;
    scheduleSettings: {
      matchupPeriodCount: number;
      playoffTeamCount: number;
      playoffSeedingRule?: string;
      matchupPeriods?: Record<string, number[]>;
    };
    rosterSettings: { lineupSlotCounts: Record<string, number> };
    acquisitionSettings: { acquisitionBudget?: number };
  };
}

export interface ProGame {
  id: number;
  scoringPeriodId: number;
  date: number; // epoch ms
  homeProTeamId: number;
  awayProTeamId: number;
  startTimeTBD?: boolean;
  validForLocking?: boolean;
}

/* ---------------------------------------------------------------- requests */

/** All season-level views in one request. ESPN merges multiple `view` params. */
export async function fetchLeague(season: number): Promise<EspnLeague> {
  const views = ['mTeam', 'mSettings', 'mMatchupScore', 'mStandings', 'mTransactions2', 'mRoster'];
  const qs = views.map((v) => `view=${v}`).join('&');
  return fetchJson<EspnLeague>(`${BASE}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?${qs}`);
}

/**
 * Per-player weekly scoring. Only mBoxscore carries
 * schedule[].{home,away}.rosterForCurrentScoringPeriod.entries[], which is the
 * (slot, player, points) triple optimal-vs-actual lineup needs.
 * NOTE: rosterForMatchupPeriod is empty in this league -- do not use it.
 */
export async function fetchBoxscore(season: number, week: number): Promise<EspnLeague> {
  return fetchJson<EspnLeague>(
    `${BASE}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?view=mBoxscore&scoringPeriodId=${week}`
  );
}

/** NFL kickoff times -- the source of truth for when a week's picks lock. */
export async function fetchProSchedule(season: number): Promise<ProGame[]> {
  const data = await fetchJson<{ settings?: { proTeams?: { proGamesByScoringPeriod?: Record<string, ProGame[]> }[] } }>(
    `${BASE}/seasons/${season}?view=proTeamSchedules_wl`
  );
  const byId = new Map<number, ProGame>();
  for (const team of data.settings?.proTeams ?? []) {
    for (const games of Object.values(team.proGamesByScoringPeriod ?? {})) {
      for (const g of games) byId.set(g.id, g);
    }
  }
  return [...byId.values()];
}

/** Free-agent pool with ownership trend. Needs the X-Fantasy-Filter header. */
export async function fetchFreeAgents(season: number, limit = 200): Promise<unknown> {
  const filter = {
    players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
      limit,
      sortPercOwned: { sortAsc: false, sortPriority: 1 },
    },
  };
  const res = await fetch(`${BASE}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?view=kona_player_info`, {
    headers: { ...HEADERS, 'x-fantasy-filter': JSON.stringify(filter) },
  });
  if (!res.ok) throw new EspnError(await res.text(), res.status, 'kona_player_info');
  return res.json();
}
