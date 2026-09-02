/**
 * The weekly recap email: types and rendering, no I/O.
 *
 * Kept pure so the whole letter can be asserted in tests without a database
 * and without sending anything. pipeline/recap-query.ts fills these types in;
 * pipeline/send-recap.ts delivers what comes out.
 *
 * Every optional section renders only when it has something to say. A heading
 * over an empty table is worse than no heading, and two of these sections --
 * the record watch and the disputed pick -- are meant to be rare.
 */

export interface RecapSurprise {
  team: string;
  player: string;
  projected: string;
  actual: string;
  delta: string;
}

export interface RecapWorstDecision {
  team: string;
  player: string;
  benchPoints: string;
  /** The starter they were eligible to replace, at the slot that starter held. */
  displaced: string;
  displacedPoints: string;
  /** What the swap would have gained -- benchPoints minus displacedPoints. */
  cost: string;
}

export interface RecapDifferentiator {
  position: string;
  homePoints: string;
  awayPoints: string;
  gap: string;
}

export interface RecapMatchupDetail {
  surprise: RecapSurprise | null;
  worstDecision: RecapWorstDecision | null;
  differentiator: RecapDifferentiator | null;
}

export interface RecapGame {
  espn_matchup_id: number;
  away_name: string;
  away_points: string | null;
  home_name: string;
  home_points: string | null;
  winner: 'HOME' | 'AWAY' | 'TIE' | string;
  detail?: RecapMatchupDetail | null;
}

export interface RecapAward {
  award_key: string;
  name: string | null;
  value: string;
}

export interface RecapBenchRow {
  name: string;
  points_for: string;
  optimal_points: string | null;
  points_left_on_bench: string | null;
}

export interface RecapStanding {
  name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: string;
}

export interface RecapPredictionRow {
  display_name: string | null;
  correct: number;
  points: string;
  accuracy: string | null;
}

export interface RecapPowerRow {
  name: string;
  rank: number;
  score: string;
  movement: number | null;
  /** Whole-number percent, or null before the odds model has run. */
  playoff_pct: string | null;
}

export interface RecapNextGame {
  away_name: string;
  home_name: string;
  away_score: string | null;
  home_score: string | null;
}

export interface RecapLuckRow {
  name: string;
  luck: string;
  wins: number;
  losses: number;
}

export interface RecapAllPlayRow {
  name: string;
  all_play_wins: number;
  all_play_losses: number;
  wins: number;
  losses: number;
  pct: string | null;
}

export interface RecapStreak {
  name: string;
  result: string;
  length: number;
}

export interface RecapGrudge {
  home: string;
  away: string;
  winner: string;
  games: number;
  /** From the home team's side of the series. */
  wins: number;
  losses: number;
  ties: number;
  first_season: number;
}

export interface RecapHistoryNote {
  label: string;
  season: number;
  detail: string;
}

export interface RecapRecordWatch {
  name: string;
  points: string;
  all_time_rank: number;
}

export interface RecapDisputedPick {
  home_name: string;
  away_name: string;
  home_votes: number;
  away_votes: number;
  winner: string;
}

export interface WeeklyRecap {
  season: number;
  week: number;
  games: RecapGame[];
  awards: RecapAward[];
  bench: RecapBenchRow[];
  standings: RecapStanding[];
  predictions: RecapPredictionRow[];
  power: RecapPowerRow[];
  nextWeek: RecapNextGame[];
  luck: RecapLuckRow[];
  allPlay: RecapAllPlayRow[];
  streaks: RecapStreak[];
  grudge: RecapGrudge | null;
  history: RecapHistoryNote[];
  recordWatch: RecapRecordWatch[];
  disputed: RecapDisputedPick | null;
}

export interface RenderedRecap {
  subject: string;
  html: string;
  text: string;
}

const AWARD_LABELS: Record<string, string> = {
  high_scorer: 'Highest score',
  low_scorer: 'Lowest score',
  blowout: 'Biggest blowout',
  // Recorded against the team that LOST it -- winning by 0.3 is luck, losing
  // by 0.3 is the part anyone remembers.
  nailbiter: 'Heartbreaking loss',
  worst_bench: 'Worst bench decision',
};

/**
 * Openers, rotated so the email does not read like a form letter.
 *
 * Chosen by week number rather than at random: the same week always renders
 * the same greeting, so a re-send is identical to the first send and a
 * delivery retry cannot produce two different emails.
 */
const INTROS = [
  "Let's see what happened last week.",
  'Another week down. Here is who covered themselves in glory and who did not.',
  'The tape does not lie. Week in review.',
  'Ten managers, five games, one weekly reckoning.',
  'Somebody had to lose. Here is how it all shook out.',
  'Rosters were set, lineups were regretted. The full accounting:',
  'Your weekly reminder that the waiver wire giveth and the bench taketh away.',
] as const;

export function introFor(week: number): string {
  return INTROS[Math.abs(Math.trunc(week)) % INTROS.length]!;
}

/** Picks close Saturday at midnight ET; stated here and enforced in the database. */
const LOCK_RULE = 'Picks lock Saturday at midnight ET — the whole of Saturday is yours.';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function record(row: RecapStanding): string {
  return `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}`;
}

function accuracy(value: string | null): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';
}

/** 1st, 2nd, 3rd -- for "the 3rd-best week ever". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** A signed points figure, so +19.8 reads as a gain at a glance. */
export function signed(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n > 0 ? `+${value}` : value;
}

/**
 * What this week's meeting did to the series.
 *
 * head_to_head already counts the game just played, so the record quoted is
 * the one the result produced -- "now 9-11", not the standing before it.
 * Wins and losses are from the HOME team's side.
 */
export function grudgeLine(g: RecapGrudge): string {
  const ties = g.ties ? `-${g.ties}` : '';
  const won = g.winner === 'HOME' ? g.home : g.winner === 'AWAY' ? g.away : null;
  // Always quote the series from the side that is actually ahead, so the
  // record reads as a lead rather than as whoever happened to be at home.
  const standing =
    g.wins > g.losses ? `${g.home} lead it ${g.wins}-${g.losses}${ties}`
    : g.losses > g.wins ? `${g.away} lead it ${g.losses}-${g.wins}${ties}`
    : `it is level at ${g.wins}-${g.losses}${ties}`;
  return won === null
    ? `They tied. All time, ${standing}.`
    : `${won} took it. All time, ${standing}.`;
}

/** Rank movement as an arrow. Null means the team was not ranked last week. */
export function movementLabel(movement: number | null): string {
  if (movement === null || movement === 0) return '—';
  return movement > 0 ? `▲${movement}` : `▼${Math.abs(movement)}`;
}

/**
 * The favourite in an upcoming game, by power-ranking score.
 *
 * Explicitly a lean and not a projection: it is the ranking gap, nothing more.
 * Returns null when either side is unranked, rather than guessing.
 */
export function lean(game: RecapNextGame): { name: string; margin: string } | null {
  if (game.home_score === null || game.away_score === null) return null;
  const home = Number(game.home_score);
  const away = Number(game.away_score);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (Math.abs(home - away) < 0.05) return null;
  return home > away
    ? { name: game.home_name, margin: (home - away).toFixed(1) }
    : { name: game.away_name, margin: (away - home).toFixed(1) };
}

/**
 * The subject line, led by the week's best performance.
 *
 * A subject that changes week to week gets opened; "Week 12 recap" does not.
 * Falls back to the plain form when no high scorer was recorded.
 */
export function recapSubject(recap: WeeklyRecap): string {
  const high = recap.awards.find((a) => a.award_key === 'high_scorer');
  if (high?.name) {
    return `Week ${recap.week}: ${high.name} drops ${high.value}`;
  }
  return `UNC Grudge Match — Week ${recap.week} recap`;
}

function normalizeSiteUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('RECAP_SITE_URL must use HTTPS.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function renderWeeklyRecap(recap: WeeklyRecap, rawSiteUrl: string): RenderedRecap {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const subject = recapSubject(recap);

  const border = 'border-bottom:1px solid #e5e7eb;padding:9px 6px;';
  const h2 = 'font-size:17px;margin:30px 0 8px;letter-spacing:-.01em';
  const table = 'width:100%;border-collapse:collapse;font-size:14px';
  const sub = 'color:#6b7280;font-size:13px;margin:0 0 10px';
  const chip = 'display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;' +
    'letter-spacing:.06em;padding:2px 7px;border-radius:99px;';

  /* ------------------------------------------------------- the matchups */

  const gamesHtml = recap.games.map((game) => {
    const awayWon = game.winner === 'AWAY';
    const homeWon = game.winner === 'HOME';
    const side = (name: string, points: string | null, won: boolean) =>
      `<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;` +
      `${won ? 'font-weight:700' : 'color:#4b5563'}">` +
      `<span>${won ? '▸ ' : '&nbsp;&nbsp;&nbsp;'}${escapeHtml(name)}</span>` +
      `<span>${escapeHtml(points ?? '—')}</span></div>`;

    const notes: string[] = [];
    const d = game.detail;
    if (d?.surprise) {
      notes.push(
        `<strong style="color:#047857">Surprise</strong> · ${escapeHtml(d.surprise.player)} ` +
        `(${escapeHtml(d.surprise.team)}) — projected ${escapeHtml(d.surprise.projected)}, ` +
        `scored <strong>${escapeHtml(d.surprise.actual)}</strong> ` +
        `<span style="color:#047857">${escapeHtml(signed(d.surprise.delta))}</span>`
      );
    }
    if (d?.worstDecision) {
      notes.push(
        `<strong style="color:#b91c1c">Worst call</strong> · ${escapeHtml(d.worstDecision.team)} ` +
        `benched ${escapeHtml(d.worstDecision.player)} (${escapeHtml(d.worstDecision.benchPoints)}) ` +
        `and started ${escapeHtml(d.worstDecision.displaced)} ` +
        `(${escapeHtml(d.worstDecision.displacedPoints)}) — ` +
        `<strong>${escapeHtml(d.worstDecision.cost)}</strong> left on the bench`
      );
    }
    if (d?.differentiator) {
      notes.push(
        `<strong style="color:#4338ca">Decided at ${escapeHtml(d.differentiator.position)}</strong> · ` +
        `${escapeHtml(game.home_name)} ${escapeHtml(d.differentiator.homePoints)} — ` +
        `${escapeHtml(game.away_name)} ${escapeHtml(d.differentiator.awayPoints)} ` +
        `(${escapeHtml(d.differentiator.gap)} apart)`
      );
    }

    return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:13px 15px;margin-bottom:12px">
      ${side(game.away_name, game.away_points, awayWon)}
      ${side(game.home_name, game.home_points, homeWon)}
      ${notes.length ? `<div style="border-top:1px solid #f1f2f4;margin-top:9px;padding-top:9px;font-size:13px;color:#374151;line-height:1.7">${notes.join('<br>')}</div>` : ''}
    </div>`;
  }).join('');

  /* ------------------------------------------------- conditional blocks */

  const recordWatchHtml = recap.recordWatch.length ? `
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:14px 16px;margin:22px 0">
      <div style="${chip}background:#f59e0b;color:white">Record watch</div>
      <div style="margin-top:8px;font-size:14px;line-height:1.7">
        ${recap.recordWatch.map((row) =>
          `<strong>${escapeHtml(row.name)}</strong>'s ${escapeHtml(row.points)} is the ` +
          `<strong>${ordinal(row.all_time_rank)}-best week</strong> in league history.`
        ).join('<br>')}
      </div>
    </div>` : '';

  const disputedHtml = recap.disputed ? (() => {
    const d = recap.disputed;
    const won = d.winner === 'HOME' ? d.home_name : d.winner === 'AWAY' ? d.away_name : null;
    return `
    <h2 style="${h2}">Most disputed pick</h2>
    <p style="${sub}">The game the league could not agree on.</p>
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.8">
      <strong>${escapeHtml(d.away_name)}</strong> ${d.away_votes} vote${d.away_votes === 1 ? '' : 's'}
      &nbsp;·&nbsp;
      <strong>${escapeHtml(d.home_name)}</strong> ${d.home_votes} vote${d.home_votes === 1 ? '' : 's'}
      ${won ? `<div style="color:#6b7280;margin-top:4px">${escapeHtml(won)} won it.</div>` : ''}
    </div>`;
  })() : '';

  /* ---------------------------------------------------------- the rest */

  const powerHtml = recap.power.length ? `
    <h2 style="${h2}">Power rankings</h2>
    <p style="${sub}">
      Weighted toward all-play record, so the schedule counts for less than the scoring.
      <a href="${escapeHtml(siteUrl)}/rankings" style="color:#2563eb">See the methodology</a>.
    </p>
    <table role="presentation" style="${table}">
      <tr><th style="${border}text-align:left" colspan="2">Team</th>
          <th style="${border}text-align:right">Score</th>
          <th style="${border}text-align:right">Move</th>
          <th style="${border}text-align:right">Playoffs</th></tr>
      ${recap.power.map((row) =>
        `<tr><td style="${border}color:#6b7280;width:22px">${row.rank}</td>` +
        `<td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
        `<td style="${border}text-align:right">${escapeHtml(row.score)}</td>` +
        `<td style="${border}text-align:right;color:${(row.movement ?? 0) > 0 ? '#047857' : (row.movement ?? 0) < 0 ? '#b91c1c' : '#9ca3af'}">` +
        `${movementLabel(row.movement)}</td>` +
        `<td style="${border}text-align:right">${row.playoff_pct === null ? '—' : `${escapeHtml(row.playoff_pct)}%`}</td></tr>`
      ).join('')}
    </table>` : '';

  const luckiest = recap.luck[0];
  const unluckiest = recap.luck[recap.luck.length - 1];
  const luckHtml = recap.luck.length >= 2 && luckiest && unluckiest ? `
    <h2 style="${h2}">Luck report</h2>
    <p style="${sub}">Wins banked against wins the schedule actually earned them.</p>
    <table role="presentation" style="${table}">
      <tr><td style="${border}"><div style="${chip}background:#dcfce7;color:#166534">Luckiest</div></td>
          <td style="${border}"><strong>${escapeHtml(luckiest.name)}</strong>
            <div style="color:#6b7280;font-size:12px">${luckiest.wins}-${luckiest.losses} with ${escapeHtml(signed(luckiest.luck))} wins of luck</div></td></tr>
      <tr><td style="${border}"><div style="${chip}background:#fee2e2;color:#991b1b">Robbed</div></td>
          <td style="${border}"><strong>${escapeHtml(unluckiest.name)}</strong>
            <div style="color:#6b7280;font-size:12px">${unluckiest.wins}-${unluckiest.losses} with ${escapeHtml(signed(unluckiest.luck))} wins of luck</div></td></tr>
    </table>` : '';

  const allPlayHtml = recap.allPlay.length ? `
    <h2 style="${h2}">All-play</h2>
    <p style="${sub}">What the record would be if everyone played everyone, every week.</p>
    <table role="presentation" style="${table}">
      <tr><th style="${border}text-align:left">Team</th>
          <th style="${border}text-align:right">All-play</th>
          <th style="${border}text-align:right">Actual</th></tr>
      ${recap.allPlay.map((row) =>
        `<tr><td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
        `<td style="${border}text-align:right">${row.all_play_wins}-${row.all_play_losses}</td>` +
        `<td style="${border}text-align:right;color:#6b7280">${row.wins}-${row.losses}</td></tr>`
      ).join('')}
    </table>` : '';

  const streakHtml = recap.streaks.length ? `
    <h2 style="${h2}">Streaks</h2>
    <table role="presentation" style="${table}">
      ${recap.streaks.map((row) =>
        `<tr><td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
        `<td style="${border}text-align:right;color:${row.result === 'W' ? '#047857' : '#b91c1c'}">` +
        `${row.result === 'W' ? 'won' : 'lost'} ${row.length} straight</td></tr>`
      ).join('')}
    </table>` : '';

  const grudgeHtml = recap.grudge ? (() => {
    const g = recap.grudge;
    return `
    <h2 style="${h2}">The Grudge</h2>
    <p style="${sub}">The game with the most history behind it this week. ESPN era, 2018 on.</p>
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;font-size:14px">
      <strong>${escapeHtml(g.home)}</strong> vs <strong>${escapeHtml(g.away)}</strong>
      <div style="margin-top:5px">${escapeHtml(grudgeLine(g))}</div>
      <div style="color:#6b7280;margin-top:4px">
        ${g.games} meetings since ${g.first_season}
      </div>
    </div>`;
  })() : '';

  const historyHtml = recap.history.length ? `
    <h2 style="${h2}">This week in Grudge history</h2>
    <table role="presentation" style="${table}">
      ${recap.history.map((row) =>
        `<tr><td style="${border}color:#6b7280;white-space:nowrap;vertical-align:top">` +
        `${escapeHtml(row.label)} · ${row.season}</td>` +
        `<td style="${border}">${escapeHtml(row.detail)}</td></tr>`
      ).join('')}
    </table>` : '';

  const nextHtml = recap.nextWeek.length ? `
    <h2 style="${h2}">Week ${recap.week + 1}</h2>
    <p style="${sub}">${escapeHtml(LOCK_RULE)} The lean is the power-rating gap, not a projected score.</p>
    <table role="presentation" style="${table}">
      ${recap.nextWeek.map((game) => {
        const pick = lean(game);
        return `<tr><td style="${border}">${escapeHtml(game.away_name)} ` +
          `<span style="color:#9ca3af">at</span> ${escapeHtml(game.home_name)}</td>` +
          `<td style="${border}text-align:right;color:#6b7280;white-space:nowrap">` +
          `${pick ? `leans ${escapeHtml(pick.name)} (+${escapeHtml(pick.margin)} rating)` : 'pick&rsquo;em'}</td></tr>`;
      }).join('')}
    </table>
    <p style="margin:14px 0 0;text-align:center">
      <a href="${escapeHtml(siteUrl)}/predictions" style="display:inline-block;background:#111827;color:white;text-decoration:none;font-weight:700;padding:11px 17px;border-radius:8px">Make your picks</a>
    </p>` : '';

  const standingsHtml = recap.standings.slice(0, 10).map((row, index) =>
    `<tr><td style="${border}color:#6b7280">${index + 1}</td><td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
    `<td style="${border}text-align:right">${escapeHtml(record(row))}</td>` +
    `<td style="${border}text-align:right">${escapeHtml(row.points_for)}</td></tr>`
  ).join('');

  const awardsHtml = recap.awards.map((award) =>
    `<tr><td style="${border}">${escapeHtml(AWARD_LABELS[award.award_key] ?? award.award_key)}</td>` +
    `<td style="${border}"><strong>${escapeHtml(award.name ?? '—')}</strong></td>` +
    `<td style="${border}text-align:right">${escapeHtml(award.value)}</td></tr>`
  ).join('');

  const predictionsHtml = recap.predictions.length ? `
    <h2 style="${h2}">Prediction leaders</h2>
    <table role="presentation" style="${table}">
      <tr><th style="${border}text-align:left">Member</th><th style="${border}text-align:right">Correct</th><th style="${border}text-align:right">Accuracy</th></tr>
      ${recap.predictions.slice(0, 3).map((row) =>
        `<tr><td style="${border}"><strong>${escapeHtml(row.display_name ?? 'League member')}</strong></td>` +
        `<td style="${border}text-align:right">${row.correct}</td><td style="${border}text-align:right">${accuracy(row.accuracy)}</td></tr>`
      ).join('')}
    </table>` : '';

  const preview = recap.recordWatch.length
    ? `${recap.recordWatch[0]!.name} put up one of the biggest weeks in league history.`
    : `Every matchup from Week ${recap.week}, and what decided it.`;

  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;color:#17191f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div>
  <div style="max-width:680px;margin:0 auto;padding:24px 14px">
    <div style="background:#111827;color:white;border-radius:12px 12px 0 0;padding:24px">
      <div style="color:#93c5fd;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">UNC Grudge Match</div>
      <h1 style="font-size:28px;margin:5px 0 0">Week ${recap.week}</h1>
      <div style="color:#cbd5e1;margin-top:6px;font-size:15px">${escapeHtml(introFor(recap.week))}</div>
      <div style="color:#8fa0b8;margin-top:3px;font-size:13px">${recap.season} season</div>
    </div>
    <div style="background:white;border-radius:0 0 12px 12px;padding:24px">
      <h2 style="${h2};margin-top:0">This week&rsquo;s games</h2>
      ${gamesHtml}
      ${recordWatchHtml}
      ${powerHtml}
      ${nextHtml}
      ${luckHtml}
      ${streakHtml}
      ${allPlayHtml}
      ${disputedHtml}
      ${grudgeHtml}
      ${historyHtml}
      ${recap.awards.length ? `<h2 style="${h2}">Awards</h2><table role="presentation" style="${table}">${awardsHtml}</table>` : ''}
      <h2 style="${h2}">Standings</h2>
      <table role="presentation" style="${table}"><tr><th style="${border}"></th><th style="${border}text-align:left">Team</th><th style="${border}text-align:right">Record</th><th style="${border}text-align:right">Points</th></tr>${standingsHtml}</table>
      ${predictionsHtml}
      <p style="margin:30px 0 8px;text-align:center"><a href="${escapeHtml(siteUrl)}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Open the full recap</a></p>
      <p style="color:#6b7280;font-size:12px;text-align:center;margin:20px 0 0">Sent to members of the UNC Grudge Match fantasy league.</p>
    </div>
  </div>
</body></html>`;

  /* --------------------------------------------------------- plain text */

  const gameText = recap.games.map((game) => {
    const lines = [
      `${game.away_name} ${game.away_points ?? '—'} at ${game.home_name} ${game.home_points ?? '—'}`,
    ];
    const d = game.detail;
    if (d?.surprise) {
      lines.push(`  Surprise: ${d.surprise.player} (${d.surprise.team}) — projected ` +
        `${d.surprise.projected}, scored ${d.surprise.actual} (${signed(d.surprise.delta)})`);
    }
    if (d?.worstDecision) {
      lines.push(`  Worst call: ${d.worstDecision.team} benched ${d.worstDecision.player} ` +
        `(${d.worstDecision.benchPoints}) and started ${d.worstDecision.displaced} ` +
        `(${d.worstDecision.displacedPoints}) — ${d.worstDecision.cost} left on the bench`);
    }
    if (d?.differentiator) {
      lines.push(`  Decided at ${d.differentiator.position}: ${game.home_name} ` +
        `${d.differentiator.homePoints} — ${game.away_name} ${d.differentiator.awayPoints}`);
    }
    return lines.join('\n');
  }).join('\n\n');

  const recordWatchText = recap.recordWatch.map((row) =>
    `${row.name}'s ${row.points} is the ${ordinal(row.all_time_rank)}-best week in league history.`
  ).join('\n');

  const powerText = recap.power.map((row) =>
    `${row.rank}. ${row.name} — ${row.score} (${movementLabel(row.movement)})` +
    (row.playoff_pct === null ? '' : `, ${row.playoff_pct}% playoffs`)
  ).join('\n');

  const nextText = recap.nextWeek.map((game) => {
    const pick = lean(game);
    return `${game.away_name} at ${game.home_name}` +
      (pick ? ` — leans ${pick.name} (+${pick.margin} rating)` : " — pick'em");
  }).join('\n');

  const luckText = luckiest && unluckiest && recap.luck.length >= 2
    ? `Luckiest: ${luckiest.name} (${luckiest.wins}-${luckiest.losses}, ${signed(luckiest.luck)} wins of luck)\n` +
      `Robbed: ${unluckiest.name} (${unluckiest.wins}-${unluckiest.losses}, ${signed(unluckiest.luck)} wins of luck)`
    : '';

  const streakText = recap.streaks.map((row) =>
    `${row.name} has ${row.result === 'W' ? 'won' : 'lost'} ${row.length} straight`
  ).join('\n');

  const allPlayText = recap.allPlay.map((row) =>
    `${row.name} — ${row.all_play_wins}-${row.all_play_losses} all-play (actual ${row.wins}-${row.losses})`
  ).join('\n');

  const grudgeText = recap.grudge
    ? `${recap.grudge.home} vs ${recap.grudge.away} — ${recap.grudge.games} meetings since ` +
      `${recap.grudge.first_season}.\n${grudgeLine(recap.grudge)}`
    : '';

  const historyText = recap.history.map((row) =>
    `${row.label} (${row.season}): ${row.detail}`
  ).join('\n');

  const disputedText = recap.disputed
    ? `${recap.disputed.away_name} ${recap.disputed.away_votes} — ` +
      `${recap.disputed.home_name} ${recap.disputed.home_votes}`
    : '';

  const awardText = recap.awards.map((award) =>
    `${AWARD_LABELS[award.award_key] ?? award.award_key}: ${award.name ?? '—'} (${award.value})`
  ).join('\n');
  const standingsText = recap.standings.slice(0, 10).map((row, index) =>
    `${index + 1}. ${row.name} — ${record(row)}, ${row.points_for} points`
  ).join('\n');
  const predictionText = recap.predictions.slice(0, 3).map((row, index) =>
    `${index + 1}. ${row.display_name ?? 'League member'} — ${row.correct} correct (${accuracy(row.accuracy)})`
  ).join('\n');

  const text = [
    `UNC Grudge Match — ${recap.season} Week ${recap.week}`,
    introFor(recap.week),
    `THIS WEEK'S GAMES\n${gameText}`,
    recordWatchText && `RECORD WATCH\n${recordWatchText}`,
    powerText && `POWER RANKINGS\n${powerText}`,
    nextText && `WEEK ${recap.week + 1}\n${LOCK_RULE}\n${nextText}`,
    luckText && `LUCK REPORT\n${luckText}`,
    streakText && `STREAKS\n${streakText}`,
    allPlayText && `ALL-PLAY\n${allPlayText}`,
    disputedText && `MOST DISPUTED PICK\n${disputedText}`,
    grudgeText && `THE GRUDGE\n${grudgeText}`,
    historyText && `THIS WEEK IN GRUDGE HISTORY\n${historyText}`,
    awardText && `AWARDS\n${awardText}`,
    `STANDINGS\n${standingsText}`,
    predictionText && `PREDICTION LEADERS\n${predictionText}`,
    `Full recap: ${siteUrl}`,
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}
