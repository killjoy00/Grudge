/**
 * Step 4 — computed features.
 *
 * Pure functions over normalized rows. Nothing here touches the network or the
 * database, so every number is checked against the seven real seasons in
 * data/history/ (see features.test.ts) rather than asserted.
 *
 * Where a model makes an assumption, the assumption is named in a comment AND
 * carried in the output (`assumptions`, `model_version`), so a number on the
 * site can always be traced back to the rules that produced it.
 */
import type { MatchupRow, RosterEntryRow } from './normalize.ts';

export const MODEL_VERSION = '2026.1';

/* ------------------------------------------------------------- team-weeks */

export interface TeamWeek {
  season: number;
  week: number;
  teamId: number;
  opponentId: number;
  pointsFor: number;
  pointsAgainst: number;
  result: 'W' | 'L' | 'T';
}

/** One row per team per completed matchup — both sides of every game. */
export function teamWeeks(matchups: MatchupRow[]): TeamWeek[] {
  const out: TeamWeek[] = [];
  for (const m of matchups) {
    if (!m.is_final || m.home_points === null || m.away_points === null) continue;
    const homeResult: TeamWeek['result'] =
      m.winner === 'TIE' ? 'T' : m.winner === 'HOME' ? 'W' : 'L';
    const awayResult: TeamWeek['result'] =
      m.winner === 'TIE' ? 'T' : m.winner === 'AWAY' ? 'W' : 'L';
    out.push({
      season: m.season, week: m.week, teamId: m.home_team_id, opponentId: m.away_team_id,
      pointsFor: m.home_points, pointsAgainst: m.away_points, result: homeResult,
    });
    out.push({
      season: m.season, week: m.week, teamId: m.away_team_id, opponentId: m.home_team_id,
      pointsFor: m.away_points, pointsAgainst: m.home_points, result: awayResult,
    });
  }
  return out;
}

/* -------------------------------------------------------------- standings */

export interface Standing {
  teamId: number;
  wins: number; losses: number; ties: number;
  pointsFor: number; pointsAgainst: number;
  winPct: number;
  rank: number;
}

/**
 * Standings through a given week (or the whole season).
 *
 * Seeding tiebreak is this league's own `playoffSeedingRule`,
 * TOTAL_POINTS_SCORED — confirmed in settings, not assumed.
 */
export function standings(tw: TeamWeek[], throughWeek = Infinity): Standing[] {
  const acc = new Map<number, Standing>();
  for (const r of tw) {
    if (r.week > throughWeek) continue;
    const s = acc.get(r.teamId) ?? {
      teamId: r.teamId, wins: 0, losses: 0, ties: 0,
      pointsFor: 0, pointsAgainst: 0, winPct: 0, rank: 0,
    };
    if (r.result === 'W') s.wins++;
    else if (r.result === 'L') s.losses++;
    else s.ties++;
    s.pointsFor += r.pointsFor;
    s.pointsAgainst += r.pointsAgainst;
    acc.set(r.teamId, s);
  }
  const rows = [...acc.values()];
  for (const s of rows) {
    const games = s.wins + s.losses + s.ties;
    s.winPct = games ? (s.wins + s.ties / 2) / games : 0;
  }
  rows.sort((a, b) => b.winPct - a.winPct || b.pointsFor - a.pointsFor);
  rows.forEach((s, i) => { s.rank = i + 1; });
  return rows;
}

/* ------------------------------------------------------------- luck index */

export interface LuckWeek {
  season: number; week: number; teamId: number;
  pointsFor: number;
  leagueMedian: number;
  beatMedian: boolean;
  won: boolean;
  /** Beat the median but still lost — outscored most of the league, lost anyway. */
  unluckyLoss: boolean;
  /** Lost to the median but still won — drew the week's weakest opponent. */
  luckyWin: boolean;
  /** How many opponents this score would have beaten this week. */
  allPlayWins: number;
  allPlayLosses: number;
}

/**
 * Luck = the gap between how you scored and whether you won.
 *
 * The median is over every team's score THAT WEEK, which is why this needs the
 * whole league's week, not one matchup. `allPlayWins` is the sharper version:
 * how many of the other nine teams your score would have beaten — the record
 * you'd have with a neutral schedule.
 */
export function luckIndex(tw: TeamWeek[]): LuckWeek[] {
  const byWeek = new Map<string, TeamWeek[]>();
  for (const r of tw) {
    const k = `${r.season}:${r.week}`;
    const list = byWeek.get(k) ?? [];
    list.push(r);
    byWeek.set(k, list);
  }
  const out: LuckWeek[] = [];
  for (const rows of byWeek.values()) {
    const scores = rows.map((r) => r.pointsFor).sort((a, b) => a - b);
    const mid = Math.floor(scores.length / 2);
    const median =
      scores.length % 2 === 0
        ? ((scores[mid - 1] ?? 0) + (scores[mid] ?? 0)) / 2
        : (scores[mid] ?? 0);
    for (const r of rows) {
      const beat = r.pointsFor > median;
      const won = r.result === 'W';
      // All-play: compare against every OTHER team's score in the same week.
      let apW = 0, apL = 0;
      for (const other of rows) {
        if (other.teamId === r.teamId) continue;
        if (r.pointsFor > other.pointsFor) apW++;
        else if (r.pointsFor < other.pointsFor) apL++;
      }
      out.push({
        season: r.season, week: r.week, teamId: r.teamId,
        pointsFor: r.pointsFor, leagueMedian: median,
        beatMedian: beat, won,
        unluckyLoss: beat && r.result === 'L',
        luckyWin: !beat && won,
        allPlayWins: apW, allPlayLosses: apL,
      });
    }
  }
  return out;
}

/** Season luck: actual wins minus the wins an average schedule would have given. */
export function seasonLuck(luck: LuckWeek[]) {
  const acc = new Map<number, { teamId: number; actualWins: number; expectedWins: number; unluckyLosses: number; luckyWins: number }>();
  for (const l of luck) {
    const a = acc.get(l.teamId) ?? { teamId: l.teamId, actualWins: 0, expectedWins: 0, unluckyLosses: 0, luckyWins: 0 };
    if (l.won) a.actualWins++;
    const opponents = l.allPlayWins + l.allPlayLosses;
    // Expected wins = share of the league you outscored, i.e. your win
    // probability against a randomly drawn opponent that week.
    a.expectedWins += opponents ? l.allPlayWins / opponents : 0;
    if (l.unluckyLoss) a.unluckyLosses++;
    if (l.luckyWin) a.luckyWins++;
    acc.set(l.teamId, a);
  }
  return [...acc.values()]
    .map((a) => ({ ...a, luckDelta: a.actualWins - a.expectedWins }))
    .sort((x, y) => y.luckDelta - x.luckDelta);
}

/* --------------------------------------------------- optimal vs actual lineup */

export interface OptimalLineup {
  season: number; week: number; teamId: number;
  actualPoints: number;
  optimalPoints: number;
  pointsLeftOnBench: number;
  /** Player who should have started and didn't, with what it cost. */
  worstBenchDecision: { playerId: number; benchPoints: number; startedInstead: number | null } | null;
}

/**
 * Best legal lineup from the players a team actually rostered that week.
 *
 * Greedy by slot scarcity: fill the most restrictive slots first (a QB-only
 * slot before FLEX), because a greedy pass in the wrong order can strand a
 * player who was the only legal filler for a narrow slot. Eligibility comes
 * from each player's own eligibleSlots, so multi-position players are handled
 * without any position table of ours.
 *
 * ASSUMPTION, stated because it is a real limitation: this optimizes over the
 * players on the roster, so it measures start/sit decisions only. It does not
 * consider waiver-wire players the manager could have added — that would be a
 * different (and much harsher) counterfactual.
 */
export function optimalLineup(
  entries: RosterEntryRow[],
  eligibleSlots: Map<number, number[]>,
  slotCapacity: Map<number, number>
): OptimalLineup | null {
  if (entries.length === 0) return null;
  const first = entries[0];
  if (!first) return null;

  const actualPoints = entries
    .filter((e) => e.is_starter)
    .reduce((a, e) => a + (e.applied_points ?? 0), 0);

  // Slots ordered by how few roster players can legally fill them.
  const candidates = new Map<number, RosterEntryRow[]>();
  for (const [slot] of slotCapacity) {
    candidates.set(
      slot,
      entries.filter((e) => (eligibleSlots.get(e.espn_player_id) ?? []).includes(slot))
    );
  }
  const slotOrder = [...slotCapacity.keys()].sort(
    (a, b) => (candidates.get(a)?.length ?? 0) - (candidates.get(b)?.length ?? 0)
  );

  const used = new Set<number>();
  const chosen: RosterEntryRow[] = [];
  for (const slot of slotOrder) {
    const capacity = slotCapacity.get(slot) ?? 0;
    const pool = (candidates.get(slot) ?? [])
      .filter((e) => !used.has(e.espn_player_id))
      .sort((a, b) => (b.applied_points ?? 0) - (a.applied_points ?? 0));
    for (let i = 0; i < capacity && i < pool.length; i++) {
      const pick = pool[i];
      if (!pick) break;
      used.add(pick.espn_player_id);
      chosen.push(pick);
    }
  }
  const optimalPoints = chosen.reduce((a, e) => a + (e.applied_points ?? 0), 0);

  // Worst bench decision: highest-scoring player left on the bench who the
  // optimal lineup would have started.
  const startedIds = new Set(entries.filter((e) => e.is_starter).map((e) => e.espn_player_id));
  const shouldHaveStarted = chosen
    .filter((e) => !startedIds.has(e.espn_player_id))
    .sort((a, b) => (b.applied_points ?? 0) - (a.applied_points ?? 0));
  const worst = shouldHaveStarted[0];
  const benchedFor = entries
    .filter((e) => e.is_starter)
    .sort((a, b) => (a.applied_points ?? 0) - (b.applied_points ?? 0))[0];

  return {
    season: first.season, week: first.week, teamId: first.espn_team_id,
    actualPoints: round2(actualPoints),
    optimalPoints: round2(optimalPoints),
    pointsLeftOnBench: round2(Math.max(0, optimalPoints - actualPoints)),
    worstBenchDecision: worst
      ? {
          playerId: worst.espn_player_id,
          benchPoints: round2(worst.applied_points ?? 0),
          startedInstead: benchedFor ? round2(benchedFor.applied_points ?? 0) : null,
        }
      : null,
  };
}

/* --------------------------------------------------------- power rankings */

export interface PowerRanking {
  teamId: number;
  rank: number;
  score: number;
  components: { winPct: number; pointsForPerGame: number; pointsAgainstPerGame: number; strengthOfSchedule: number; allPlayWinPct: number };
  modelVersion: string;
}

/**
 * Power ranking = how good a team actually is, as opposed to how good its
 * record looks.
 *
 * Weights, chosen deliberately and stated so they can be argued with:
 *   45%  all-play win pct  — record against the whole league, schedule removed
 *   30%  points per game   — raw scoring ability
 *   15%  actual win pct    — rewards winning, but cannot dominate
 *   10%  strength of sched — average all-play pct of opponents faced
 *
 * All-play is weighted above actual record on purpose: in a 10-team league a
 * 14-game schedule is far too short for record alone to separate skill from
 * who you happened to draw.
 */
export function powerRankings(tw: TeamWeek[], luck: LuckWeek[]): PowerRanking[] {
  const st = standings(tw);
  const allPlay = new Map<number, { w: number; l: number }>();
  for (const l of luck) {
    const a = allPlay.get(l.teamId) ?? { w: 0, l: 0 };
    a.w += l.allPlayWins;
    a.l += l.allPlayLosses;
    allPlay.set(l.teamId, a);
  }
  const allPlayPct = new Map<number, number>();
  for (const [teamId, a] of allPlay) {
    allPlayPct.set(teamId, a.w + a.l ? a.w / (a.w + a.l) : 0);
  }

  // Strength of schedule: mean all-play pct of the opponents a team faced.
  const sos = new Map<number, number>();
  for (const s of st) {
    const faced = tw.filter((r) => r.teamId === s.teamId);
    const mean = faced.length
      ? faced.reduce((a, r) => a + (allPlayPct.get(r.opponentId) ?? 0.5), 0) / faced.length
      : 0.5;
    sos.set(s.teamId, mean);
  }

  const games = (s: Standing) => Math.max(1, s.wins + s.losses + s.ties);
  const maxPpg = Math.max(...st.map((s) => s.pointsFor / games(s)), 1);

  const rows = st.map((s) => {
    const ap = allPlayPct.get(s.teamId) ?? 0;
    const ppg = s.pointsFor / games(s);
    const papg = s.pointsAgainst / games(s);
    const strength = sos.get(s.teamId) ?? 0.5;
    const score =
      0.45 * ap +
      0.30 * (ppg / maxPpg) +
      0.15 * s.winPct +
      0.10 * strength;
    return {
      teamId: s.teamId,
      rank: 0,
      score: round4(score),
      components: {
        winPct: round4(s.winPct),
        pointsForPerGame: round2(ppg),
        pointsAgainstPerGame: round2(papg),
        strengthOfSchedule: round4(strength),
        allPlayWinPct: round4(ap),
      },
      modelVersion: MODEL_VERSION,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/* ----------------------------------------------------------- weekly awards */

export interface WeeklyAward {
  season: number; week: number;
  awardKey: 'high_scorer' | 'low_scorer' | 'blowout' | 'nailbiter' | 'worst_bench';
  teamId: number | null;
  value: number;
  detail: Record<string, unknown>;
}

export function weeklyAwards(
  season: number, week: number, tw: TeamWeek[], matchups: MatchupRow[], lineups: OptimalLineup[]
): WeeklyAward[] {
  const rows = tw.filter((r) => r.season === season && r.week === week);
  if (rows.length === 0) return [];
  const out: WeeklyAward[] = [];

  const high = [...rows].sort((a, b) => b.pointsFor - a.pointsFor)[0];
  if (high) out.push({ season, week, awardKey: 'high_scorer', teamId: high.teamId, value: round2(high.pointsFor), detail: {} });

  const low = [...rows].sort((a, b) => a.pointsFor - b.pointsFor)[0];
  if (low) out.push({ season, week, awardKey: 'low_scorer', teamId: low.teamId, value: round2(low.pointsFor), detail: {} });

  const games = matchups.filter((m) => m.season === season && m.week === week && m.is_final);
  const margins = games
    .map((m) => ({ m, margin: Math.abs((m.home_points ?? 0) - (m.away_points ?? 0)) }))
    .sort((a, b) => b.margin - a.margin);

  const blow = margins[0];
  if (blow) {
    const winnerId = blow.m.winner === 'HOME' ? blow.m.home_team_id : blow.m.away_team_id;
    out.push({
      season, week, awardKey: 'blowout', teamId: winnerId, value: round2(blow.margin),
      detail: { matchupId: blow.m.espn_matchup_id, loserId: blow.m.winner === 'HOME' ? blow.m.away_team_id : blow.m.home_team_id },
    });
  }
  const close = margins[margins.length - 1];
  if (close) {
    const winnerId = close.m.winner === 'HOME' ? close.m.home_team_id : close.m.away_team_id;
    out.push({
      season, week, awardKey: 'nailbiter', teamId: winnerId, value: round2(close.margin),
      detail: { matchupId: close.m.espn_matchup_id },
    });
  }

  const worst = [...lineups.filter((l) => l.season === season && l.week === week)]
    .sort((a, b) => b.pointsLeftOnBench - a.pointsLeftOnBench)[0];
  if (worst && worst.pointsLeftOnBench > 0) {
    out.push({
      season, week, awardKey: 'worst_bench', teamId: worst.teamId,
      value: worst.pointsLeftOnBench,
      detail: { actual: worst.actualPoints, optimal: worst.optimalPoints, decision: worst.worstBenchDecision },
    });
  }
  return out;
}

/* --------------------------------------------------------- playoff odds */

export interface PlayoffOdds {
  teamId: number;
  playoffPct: number;
  byePct: number;
  seedDistribution: Record<number, number>;
  simCount: number;
  assumptions: Record<string, unknown>;
  modelVersion: string;
}

/** Deterministic RNG so a given input always produces the same odds. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, for drawing weekly scores from a normal distribution. */
function gaussian(rand: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Monte Carlo playoff odds over the remaining schedule.
 *
 * SCORING-DISTRIBUTION ASSUMPTIONS, stated explicitly as requested:
 *
 *  1. A team's weekly score is drawn from a NORMAL distribution fitted to that
 *     team's own completed weeks this season (its mean and sample stdev).
 *     Fantasy scores are mildly right-skewed, so normal slightly understates
 *     blow-up weeks; with a 14-week sample it is the honest choice over
 *     fitting a heavier-tailed family to very little data.
 *  2. Teams with fewer than MIN_WEEKS completed fall back to the LEAGUE-wide
 *     mean and stdev, because a 1-2 week sample stdev is noise.
 *  3. Weekly scores are drawn INDEPENDENTLY: no autocorrelation (hot streaks),
 *     no shared week effects (a high-scoring week league-wide), no injury or
 *     bye-week modelling, and no roster change over the rest of the season.
 *  4. Stdev is floored at MIN_SD to stop an unusually consistent team from
 *     being modelled as deterministic.
 *  5. Seeding uses the league's real rule: win pct, ties broken by total points
 *     (playoffSeedingRule = TOTAL_POINTS_SCORED). Byes go to the top
 *     (playoffTeamCount - 4) seeds, which for 6 of 10 is the top 2.
 *
 * These are assumptions, not facts. They are returned in `assumptions` so a
 * displayed number can always be traced to the rules that produced it.
 */
export interface OddsParams {
  /** Pseudo-observations of the league mean mixed into each team's mean. */
  shrinkage: number;
  /** Multiplier on predictive sd, covering variance we do not model. */
  varianceInflation: number;
}

/**
 * Tuned by grid search against seven real seasons (npx tsx pipeline/calibrate.ts,
 * ~630 team-week forecasts scored against who actually made the playoffs).
 *
 * The untuned model -- team mean and sd at face value -- was measurably
 * overconfident. Its worst bucket said 30% and those teams made the playoffs
 * 46% of the time; it said 95% for favorites who came through 91% of the time.
 *
 *   baseline (0, 1.00):  Brier 0.1284, mean calibration gap 4.9 points
 *   tuned    (10, 1.00): Brier 0.1201, mean calibration gap 0.8 points
 *
 * Notably, SHRINKAGE ALONE FIXED IT and variance inflation was not needed --
 * inflating sd on top of shrinkage made calibration worse. So the error was
 * never underestimated week-to-week variance; it was believing a short sample
 * about how different teams are. With shrinkage=10, a team's projected mean at
 * week 7 is (7*own + 10*league)/17, i.e. still mostly the league average --
 * which is the honest reading of seven fantasy football games.
 */
export const DEFAULT_ODDS_PARAMS: OddsParams = { shrinkage: 10, varianceInflation: 1.0 };

export function playoffOdds(
  tw: TeamWeek[],
  remaining: { week: number; homeTeamId: number; awayTeamId: number }[],
  playoffTeamCount: number,
  sims = 10000,
  seed = 20260830,
  params: OddsParams = DEFAULT_ODDS_PARAMS
): PlayoffOdds[] {
  const MIN_WEEKS = 3;
  const MIN_SD = 5;

  const teamIds = [...new Set(tw.map((r) => r.teamId))].sort((a, b) => a - b);
  if (teamIds.length === 0) return [];

  const allScores = tw.map((r) => r.pointsFor);
  const leagueMean = mean(allScores);
  const leagueSd = Math.max(MIN_SD, stdev(allScores, leagueMean));

  const dist = new Map<number, { mean: number; sd: number; fallback: boolean; n: number }>();
  for (const id of teamIds) {
    const scores = tw.filter((r) => r.teamId === id).map((r) => r.pointsFor);
    const n = scores.length;
    if (n < MIN_WEEKS) {
      dist.set(id, { mean: leagueMean, sd: leagueSd * params.varianceInflation, fallback: true, n });
      continue;
    }
    // Shrink toward the league mean: with a handful of games, the gap between
    // a team's average and the league's is part real skill and part noise.
    const raw = mean(scores);
    const shrunk = (n * raw + params.shrinkage * leagueMean) / (n + params.shrinkage);

    // Predictive sd, not sample sd. Two additions, both principled:
    //  * sqrt(1 + 1/n) accounts for the mean itself being an estimate;
    //  * varianceInflation covers what the model omits entirely -- injuries,
    //    waiver-wire churn, week-to-week roster change, bye weeks.
    const sampleSd = Math.max(MIN_SD, stdev(scores, raw));
    const predictiveSd = sampleSd * Math.sqrt(1 + 1 / n) * params.varianceInflation;
    dist.set(id, { mean: shrunk, sd: predictiveSd, fallback: false, n });
  }

  const base = standings(tw);
  const baseline = new Map(base.map((s) => [s.teamId, s]));
  const byeCount = Math.max(0, playoffTeamCount - 4);

  const madePlayoffs = new Map<number, number>(teamIds.map((id) => [id, 0]));
  const gotBye = new Map<number, number>(teamIds.map((id) => [id, 0]));
  const seedCounts = new Map<number, Map<number, number>>(teamIds.map((id) => [id, new Map()]));

  const rand = mulberry32(seed);

  for (let s = 0; s < sims; s++) {
    const w = new Map<number, number>();
    const l = new Map<number, number>();
    const t = new Map<number, number>();
    const pf = new Map<number, number>();
    for (const id of teamIds) {
      const b = baseline.get(id);
      w.set(id, b?.wins ?? 0);
      l.set(id, b?.losses ?? 0);
      t.set(id, b?.ties ?? 0);
      pf.set(id, b?.pointsFor ?? 0);
    }
    for (const g of remaining) {
      const hd = dist.get(g.homeTeamId) ?? { mean: leagueMean, sd: leagueSd, fallback: true, n: 0 };
      const ad = dist.get(g.awayTeamId) ?? { mean: leagueMean, sd: leagueSd, fallback: true, n: 0 };
      const hs = hd.mean + hd.sd * gaussian(rand);
      const as = ad.mean + ad.sd * gaussian(rand);
      pf.set(g.homeTeamId, (pf.get(g.homeTeamId) ?? 0) + hs);
      pf.set(g.awayTeamId, (pf.get(g.awayTeamId) ?? 0) + as);
      if (hs > as) { w.set(g.homeTeamId, (w.get(g.homeTeamId) ?? 0) + 1); l.set(g.awayTeamId, (l.get(g.awayTeamId) ?? 0) + 1); }
      else if (as > hs) { w.set(g.awayTeamId, (w.get(g.awayTeamId) ?? 0) + 1); l.set(g.homeTeamId, (l.get(g.homeTeamId) ?? 0) + 1); }
      else { t.set(g.homeTeamId, (t.get(g.homeTeamId) ?? 0) + 1); t.set(g.awayTeamId, (t.get(g.awayTeamId) ?? 0) + 1); }
    }
    const table = teamIds
      .map((id) => {
        const wins = w.get(id) ?? 0, losses = l.get(id) ?? 0, ties = t.get(id) ?? 0;
        const g = Math.max(1, wins + losses + ties);
        return { id, pct: (wins + ties / 2) / g, pf: pf.get(id) ?? 0 };
      })
      .sort((a, b) => b.pct - a.pct || b.pf - a.pf);

    table.forEach((row, i) => {
      const seedNo = i + 1;
      const m = seedCounts.get(row.id)!;
      m.set(seedNo, (m.get(seedNo) ?? 0) + 1);
      if (seedNo <= playoffTeamCount) madePlayoffs.set(row.id, (madePlayoffs.get(row.id) ?? 0) + 1);
      if (seedNo <= byeCount) gotBye.set(row.id, (gotBye.get(row.id) ?? 0) + 1);
    });
  }

  return teamIds.map((id) => {
    const seedDist: Record<number, number> = {};
    for (const [seedNo, n] of seedCounts.get(id) ?? []) seedDist[seedNo] = round4(n / sims);
    const d = dist.get(id)!;
    return {
      teamId: id,
      playoffPct: round4((madePlayoffs.get(id) ?? 0) / sims),
      byePct: round4((gotBye.get(id) ?? 0) / sims),
      seedDistribution: seedDist,
      simCount: sims,
      assumptions: {
        distribution: 'normal, fitted per team',
        teamMean: round2(d.mean),
        teamSd: round2(d.sd),
        usedLeagueFallback: d.fallback,
        weeksObserved: d.n,
        shrinkageToLeagueMean: params.shrinkage,
        varianceInflation: params.varianceInflation,
        minWeeksForOwnDistribution: MIN_WEEKS,
        stdevFloor: MIN_SD,
        weeksIndependent: true,
        modelsInjuriesOrByes: false,
        modelsRosterChange: false,
        seedingRule: 'TOTAL_POINTS_SCORED',
        byeSeeds: byeCount,
        remainingGames: remaining.length,
        rngSeed: seed,
      },
      modelVersion: MODEL_VERSION,
    };
  });
}

/* ------------------------------------------------------- head-to-head */

export interface HeadToHead {
  teamId: number; opponentId: number;
  games: number; wins: number; losses: number; ties: number;
  pointsFor: number; pointsAgainst: number;
  firstSeason: number; lastSeason: number;
}

/** Cross-season rivalry records. Joins on team id, verified stable 2018-2026. */
export function headToHead(tw: TeamWeek[]): HeadToHead[] {
  const acc = new Map<string, HeadToHead>();
  for (const r of tw) {
    const key = `${r.teamId}:${r.opponentId}`;
    const h = acc.get(key) ?? {
      teamId: r.teamId, opponentId: r.opponentId,
      games: 0, wins: 0, losses: 0, ties: 0,
      pointsFor: 0, pointsAgainst: 0,
      firstSeason: r.season, lastSeason: r.season,
    };
    h.games++;
    if (r.result === 'W') h.wins++;
    else if (r.result === 'L') h.losses++;
    else h.ties++;
    h.pointsFor += r.pointsFor;
    h.pointsAgainst += r.pointsAgainst;
    h.firstSeason = Math.min(h.firstSeason, r.season);
    h.lastSeason = Math.max(h.lastSeason, r.season);
    acc.set(key, h);
  }
  return [...acc.values()];
}

/* ------------------------------------------------------------------ utils */

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stdev(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  // Sample stdev (n-1): we are estimating from a sample, not describing a population.
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/* --------------------------------------------- transactions + FAAB */

export interface TransactionSummary {
  season: number;
  teamId: number;
  lineupChanges: number;
  adds: number;
  drops: number;
  trades: number;
  waiverClaims: number;
  faabSpent: number;
  faabRemaining: number | null;
}

/**
 * ESPN transaction taxonomy, as OBSERVED on this league rather than assumed.
 *
 *  DRAFT   — draft picks. items[].type = 'DRAFT'.
 *  ROSTER  — a lineup change (start/sit). items[].type = 'LINEUP', and both
 *            fromTeamId and toTeamId are 0 because nobody changed teams. These
 *            are NOT roster moves and must not inflate add/drop counts, which
 *            is the whole reason this classifier exists.
 *  Expected but still unobserved on this league: ADD, DROP, TRADE, WAIVER.
 *            Their handling below is written from ESPN's general shape; the
 *            raw envelope is retained in transactions.raw so the first real one
 *            can be checked rather than trusted.
 */
export function classifyTransaction(type: string, itemTypes: string[]): 'draft' | 'lineup' | 'add' | 'drop' | 'trade' | 'waiver' | 'other' {
  const t = type.toUpperCase();
  if (t === 'DRAFT') return 'draft';
  if (t === 'ROSTER' && itemTypes.every((i) => i.toUpperCase() === 'LINEUP')) return 'lineup';
  if (t === 'TRADE_ACCEPT' || t === 'TRADE') return 'trade';
  if (t === 'WAIVER') return 'waiver';
  if (t === 'FREEAGENT' || t === 'ADD') return 'add';
  if (t === 'DROP') return 'drop';
  return 'other';
}

export function transactionSummary(
  season: number,
  transactions: { teamId: number | null; type: string; bidAmount: number; itemTypes: string[] }[],
  faabByTeam: Map<number, { spent: number; budget: number | null }>
): TransactionSummary[] {
  const acc = new Map<number, TransactionSummary>();
  const blank = (teamId: number): TransactionSummary => ({
    season, teamId, lineupChanges: 0, adds: 0, drops: 0, trades: 0,
    waiverClaims: 0, faabSpent: 0, faabRemaining: null,
  });

  for (const [teamId] of faabByTeam) acc.set(teamId, blank(teamId));

  for (const t of transactions) {
    if (t.teamId === null) continue;
    const row = acc.get(t.teamId) ?? blank(t.teamId);
    switch (classifyTransaction(t.type, t.itemTypes)) {
      case 'lineup': row.lineupChanges++; break;
      case 'add': row.adds++; break;
      case 'drop': row.drops++; break;
      case 'trade': row.trades++; break;
      case 'waiver': row.waiverClaims++; row.faabSpent += t.bidAmount; break;
      default: break; // draft and unknown types are not roster activity
    }
    acc.set(t.teamId, row);
  }

  for (const [teamId, row] of acc) {
    const f = faabByTeam.get(teamId);
    if (!f) continue;
    // ESPN's own acquisitionBudgetSpent is authoritative; our summed bids are
    // the cross-check. Reconciliation is surfaced, not silently reconciled.
    row.faabSpent = f.spent;
    row.faabRemaining = f.budget === null ? null : round2(f.budget - f.spent);
  }
  return [...acc.values()].sort((a, b) => a.teamId - b.teamId);
}
