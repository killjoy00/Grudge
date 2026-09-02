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
  /** Who they lost to, or who they benched. Null for awards with no counterpart. */
  against: string | null;
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
  games: number;
  pct: string | null;
  /** All-play rescaled to games actually played, so it sits beside the record. */
  scaled_wins: string | null;
  scaled_losses: string | null;
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

/**
 * All-play on the same scale as the real record.
 *
 * Raw all-play counts nine games a week, so a 14-week season reads 87-39 and
 * cannot be compared to 8-6 without arithmetic. Rescaled to games actually
 * played it becomes 9.7-4.3, which says "should have two more wins" at a
 * glance. Falls back to the raw figure if the scaling is unavailable.
 */
export function allPlayRecord(row: RecapAllPlayRow): string {
  if (row.scaled_wins === null || row.scaled_losses === null) {
    return `${row.all_play_wins}-${row.all_play_losses}`;
  }
  return `${row.scaled_wins}-${row.scaled_losses}`;
}

/** The second name an award needs: who beat them, or who they sat. */
export function awardAside(award: RecapAward): string {
  if (award.against === null) return '';
  return award.award_key === 'nailbiter' ? `lost to ${award.against}` : `benched ${award.against}`;
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
  const table = 'width:100%;border-collapse:collapse;font-size:14px';
  const sub = 'color:#6b7280;font-size:13px;margin:0 0 10px';
  const chip = 'display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;' +
    'letter-spacing:.06em;padding:2px 7px;border-radius:99px;';

  /**
   * One accent colour per section, reused for its rule, its label and its
   * numbers. The matchup cards already earned these three -- green for the
   * surprise, red for the blunder, indigo for the margin -- so the rest of the
   * letter borrows the same family rather than inventing a second palette.
   */
  const ACCENT = {
    games: '#4338ca', record: '#b45309', power: '#0f766e', luck: '#7c3aed',
    streak: '#be123c', allplay: '#0369a1', disputed: '#a21caf',
    grudge: '#9a3412', history: '#4d7c0f', awards: '#a16207',
    standings: '#334155', predictions: '#1d4ed8', next: '#047857',
  } as const;

  /**
   * A section header: a coloured rule, a small caps label, the title, and an
   * optional line of explanation. Every section is built through this, which
   * is what stops the email drifting back into an undifferentiated stack of
   * bold text and tables.
   */
  const head = (accent: string, label: string, title: string, note = '') =>
    `<div style="margin:32px 0 10px">
       <div style="height:3px;width:34px;background:${accent};border-radius:2px"></div>
       <div style="color:${accent};font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;margin-top:9px">${escapeHtml(label)}</div>
       <h2 style="font-size:19px;margin:2px 0 0;letter-spacing:-.02em">${title}</h2>
       ${note ? `<p style="${sub};margin-top:5px">${note}</p>` : ''}
     </div>`;

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
    <div style="background:linear-gradient(135deg,#fffbeb,#fef3c7);border:1px solid #fcd34d;border-radius:12px;padding:16px 18px;margin:24px 0">
      <div style="${chip}background:#b45309;color:white">Record watch</div>
      <div style="margin-top:9px;font-size:15px;line-height:1.7">
        ${recap.recordWatch.map((row) =>
          `<strong>${escapeHtml(row.name)}</strong>&rsquo;s ` +
          `<strong style="color:${ACCENT.record}">${escapeHtml(row.points)}</strong> is the ` +
          `<strong>${ordinal(row.all_time_rank)}-best week</strong> in league history.`
        ).join('<br>')}
      </div>
    </div>` : '';

  const disputedHtml = recap.disputed ? (() => {
    const d = recap.disputed;
    const won = d.winner === 'HOME' ? d.home_name : d.winner === 'AWAY' ? d.away_name : null;
    const side = (name: string, votes: number, right: boolean) =>
      `<div style="flex:1;padding:10px 12px;border-radius:8px;background:${right ? '#ecfdf5' : '#f8fafc'};` +
      `border:1px solid ${right ? '#a7f3d0' : '#e5e7eb'}">` +
      `<div style="font-weight:700">${escapeHtml(name)}</div>` +
      `<div style="color:#6b7280;font-size:12px;margin-top:2px">${votes} vote${votes === 1 ? '' : 's'}` +
      `${right ? ' &middot; right' : ''}</div></div>`;
    return head(ACCENT.disputed, 'Split house', 'Most disputed pick',
      'The game the league could not agree on.') + `
    <div style="display:flex;gap:10px">
      ${side(d.away_name, d.away_votes, won === d.away_name)}
      ${side(d.home_name, d.home_votes, won === d.home_name)}
    </div>`;
  })() : '';

  /* ---------------------------------------------------------- the rest */

  const powerHtml = recap.power.length
    ? head(ACCENT.power, 'The pecking order', 'Power rankings',
        `40% all-play, 30% points per game, 20% actual record, 10% strength of schedule. ` +
        `<a href="${escapeHtml(siteUrl)}/rankings" style="color:${ACCENT.power};font-weight:600">See the methodology</a>.`) + `
    <table role="presentation" style="${table}">
      <tr><th style="${border}text-align:left" colspan="2">Team</th>
          <th style="${border}text-align:right">Score</th>
          <th style="${border}text-align:right">Move</th>
          <th style="${border}text-align:right">Playoffs</th></tr>
      ${recap.power.map((row) =>
        `<tr><td style="${border}color:${ACCENT.power};width:26px;font-weight:800">${row.rank}</td>` +
        `<td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
        `<td style="${border}text-align:right;font-variant-numeric:tabular-nums">${escapeHtml(row.score)}</td>` +
        `<td style="${border}text-align:right;font-weight:700;color:${(row.movement ?? 0) > 0 ? '#047857' : (row.movement ?? 0) < 0 ? '#b91c1c' : '#9ca3af'}">` +
        `${movementLabel(row.movement)}</td>` +
        `<td style="${border}text-align:right;font-variant-numeric:tabular-nums">${row.playoff_pct === null ? '—' : `${escapeHtml(row.playoff_pct)}%`}</td></tr>`
      ).join('')}
    </table>` : '';

  const luckiest = recap.luck[0];
  const unluckiest = recap.luck[recap.luck.length - 1];
  const luckHtml = recap.luck.length >= 2 && luckiest && unluckiest
    ? head(ACCENT.luck, 'Fortune', 'Luck report',
        'Wins banked against wins their scoring actually earned.') + `
    <div style="display:flex;gap:10px">
      <div style="flex:1;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:10px;padding:13px 15px">
        <div style="${chip}background:#166534;color:white">Luckiest</div>
        <div style="font-weight:700;margin-top:8px">${escapeHtml(luckiest.name)}</div>
        <div style="color:#6b7280;font-size:12px;margin-top:2px">
          ${luckiest.wins}-${luckiest.losses} &middot; <strong style="color:#166534">${escapeHtml(signed(luckiest.luck))}</strong> wins
        </div>
      </div>
      <div style="flex:1;border:1px solid #fecaca;background:#fef2f2;border-radius:10px;padding:13px 15px">
        <div style="${chip}background:#991b1b;color:white">Robbed</div>
        <div style="font-weight:700;margin-top:8px">${escapeHtml(unluckiest.name)}</div>
        <div style="color:#6b7280;font-size:12px;margin-top:2px">
          ${unluckiest.wins}-${unluckiest.losses} &middot; <strong style="color:#991b1b">${escapeHtml(signed(unluckiest.luck))}</strong> wins
        </div>
      </div>
    </div>` : '';

  const allPlayHtml = recap.allPlay.length
    ? head(ACCENT.allplay, 'Everyone, every week', 'All-play',
        'What the record would be against the whole league each week, ' +
        'scaled to the same number of games as the real one.') + `
    <table role="presentation" style="${table}">
      <tr><th style="${border}text-align:left">Team</th>
          <th style="${border}text-align:right">All-play</th>
          <th style="${border}text-align:right">Actual</th></tr>
      ${recap.allPlay.map((row) =>
        `<tr><td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
        `<td style="${border}text-align:right;font-variant-numeric:tabular-nums">` +
        `<strong style="color:${ACCENT.allplay}">${escapeHtml(allPlayRecord(row))}</strong>` +
        `<span style="color:#9ca3af"> (${row.all_play_wins}-${row.all_play_losses})</span></td>` +
        `<td style="${border}text-align:right;color:#6b7280;font-variant-numeric:tabular-nums">${row.wins}-${row.losses}</td></tr>`
      ).join('')}
    </table>` : '';

  const streakHtml = recap.streaks.length
    ? head(ACCENT.streak, 'On a run', 'Streaks') + `
    <table role="presentation" style="${table}">
      ${recap.streaks.map((row) =>
        `<tr><td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
        `<td style="${border}text-align:right;font-weight:700;color:${row.result === 'W' ? '#047857' : '#b91c1c'}">` +
        `${row.result === 'W' ? 'won' : 'lost'} ${row.length} straight</td></tr>`
      ).join('')}
    </table>` : '';

  const grudgeHtml = recap.grudge ? (() => {
    const g = recap.grudge;
    return head(ACCENT.grudge, 'Old business', 'The Grudge',
      'The game with the most history behind it this week. ESPN era, 2018 on.') + `
    <div style="border:1px solid #fed7aa;background:#fff7ed;border-radius:12px;padding:16px 18px;font-size:15px">
      <strong>${escapeHtml(g.home)}</strong>
      <span style="color:#9ca3af">vs</span>
      <strong>${escapeHtml(g.away)}</strong>
      <div style="margin-top:6px;color:${ACCENT.grudge};font-weight:600">${escapeHtml(grudgeLine(g))}</div>
      <div style="color:#6b7280;margin-top:4px;font-size:13px">
        ${g.games} meetings since ${g.first_season}
      </div>
    </div>`;
  })() : '';

  const historyHtml = recap.history.length
    ? head(ACCENT.history, 'The archive', 'This week in Grudge Match history') + `
    ${recap.history.map((row) =>
      `<div style="border-left:3px solid ${ACCENT.history};background:#f7fee7;border-radius:0 8px 8px 0;padding:12px 15px;font-size:14px">` +
      `<div style="${chip}background:${ACCENT.history};color:white">${escapeHtml(row.label)} &middot; ${row.season}</div>` +
      `<div style="margin-top:7px">${escapeHtml(row.detail)}</div></div>`
    ).join('')}` : '';

  const nextHtml = recap.nextWeek.length
    ? head(ACCENT.next, 'Coming up', `Week ${recap.week + 1}`,
        `${escapeHtml(LOCK_RULE)} The call is the power-rating gap, not a projected score.`) + `
    <table role="presentation" style="${table}">
      ${recap.nextWeek.map((game) => {
        const pick = lean(game);
        return `<tr><td style="${border}">${escapeHtml(game.away_name)} ` +
          `<span style="color:#9ca3af">at</span> ${escapeHtml(game.home_name)}</td>` +
          `<td style="${border}text-align:right;white-space:nowrap">` +
          `${pick
            ? `<strong style="color:${ACCENT.next}">${escapeHtml(pick.name)}</strong>` +
              `<span style="color:#9ca3af"> +${escapeHtml(pick.margin)}</span>`
            : '<span style="color:#9ca3af">pick&rsquo;em</span>'}</td></tr>`;
      }).join('')}
    </table>
    <p style="margin:16px 0 0;text-align:center">
      <a href="${escapeHtml(siteUrl)}/predictions" style="display:inline-block;background:${ACCENT.next};color:white;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Make your picks</a>
    </p>` : '';

  const standingsHtml = recap.standings.slice(0, 10).map((row, index) =>
    `<tr><td style="${border}color:${index < 6 ? ACCENT.standings : '#cbd5e1'};font-weight:800;width:26px">${index + 1}</td>` +
    `<td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
    `<td style="${border}text-align:right;font-variant-numeric:tabular-nums">${escapeHtml(record(row))}</td>` +
    `<td style="${border}text-align:right;color:#6b7280;font-variant-numeric:tabular-nums">${escapeHtml(row.points_for)}</td></tr>`
  ).join('');

  const awardsHtml = recap.awards.map((award) =>
    `<tr><td style="${border}color:#6b7280">${escapeHtml(AWARD_LABELS[award.award_key] ?? award.award_key)}</td>` +
    `<td style="${border}"><strong>${escapeHtml(award.name ?? '—')}</strong>` +
    `${award.against ? `<span style="color:#9ca3af"> (${escapeHtml(awardAside(award))})</span>` : ''}</td>` +
    `<td style="${border}text-align:right;font-variant-numeric:tabular-nums">${escapeHtml(award.value)}</td></tr>`
  ).join('');

  const predictionsHtml = recap.predictions.length
    ? head(ACCENT.predictions, 'The oracle standings', 'Prediction leaders') + `
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
<html><body style="margin:0;background:#eef1f6;color:#17191f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div>
  <div style="max-width:680px;margin:0 auto;padding:24px 14px">
    <div style="background:linear-gradient(135deg,#111827 0%,#1e2a44 55%,#312e5f 100%);color:white;border-radius:14px 14px 0 0;padding:26px 24px 24px">
      <div style="color:#93c5fd;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em">UNC Grudge Match</div>
      <h1 style="font-size:34px;margin:6px 0 0;letter-spacing:-.03em">Week ${recap.week}</h1>
      <div style="height:3px;width:46px;background:#93c5fd;border-radius:2px;margin:12px 0 11px"></div>
      <div style="color:#e2e8f0;font-size:15px;line-height:1.5">${escapeHtml(introFor(recap.week))}</div>
      <div style="color:#94a3b8;margin-top:4px;font-size:12px;letter-spacing:.04em">${recap.season} SEASON</div>
    </div>
    <div style="background:white;border-radius:0 0 14px 14px;padding:8px 24px 26px">
      ${head(ACCENT.games, 'The tape', 'This week&rsquo;s games')}
      ${gamesHtml}
      ${recordWatchHtml}
      ${powerHtml}
      ${luckHtml}
      ${streakHtml}
      ${allPlayHtml}
      ${disputedHtml}
      ${grudgeHtml}
      ${historyHtml}
      ${recap.awards.length ? head(ACCENT.awards, 'Hardware', 'Awards') + `<table role="presentation" style="${table}">${awardsHtml}</table>` : ''}
      ${head(ACCENT.standings, 'Where it stands', 'Standings',
        'The top six make the bracket.')}
      <table role="presentation" style="${table}"><tr><th style="${border}"></th><th style="${border}text-align:left">Team</th><th style="${border}text-align:right">Record</th><th style="${border}text-align:right">Points</th></tr>${standingsHtml}</table>
      ${predictionsHtml}
      ${nextHtml}
      <p style="margin:32px 0 8px;text-align:center"><a href="${escapeHtml(siteUrl)}" style="display:inline-block;background:#111827;color:white;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Open the full site</a></p>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:18px 0 0">Sent to members of the UNC Grudge Match fantasy league.</p>
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
      (pick ? ` — ${pick.name} by ${pick.margin} (power rating)` : " — pick'em");
  }).join('\n');

  const luckText = luckiest && unluckiest && recap.luck.length >= 2
    ? `Luckiest: ${luckiest.name} (${luckiest.wins}-${luckiest.losses}, ${signed(luckiest.luck)} wins of luck)\n` +
      `Robbed: ${unluckiest.name} (${unluckiest.wins}-${unluckiest.losses}, ${signed(unluckiest.luck)} wins of luck)`
    : '';

  const streakText = recap.streaks.map((row) =>
    `${row.name} has ${row.result === 'W' ? 'won' : 'lost'} ${row.length} straight`
  ).join('\n');

  const allPlayText = recap.allPlay.map((row) =>
    `${row.name} — ${allPlayRecord(row)} all-play ` +
    `(${row.all_play_wins}-${row.all_play_losses} raw; actual ${row.wins}-${row.losses})`
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

  const awardText = recap.awards.map((award) => {
    const aside = award.against ? `, ${awardAside(award)}` : '';
    return `${AWARD_LABELS[award.award_key] ?? award.award_key}: ` +
      `${award.name ?? '—'} (${award.value}${aside})`;
  }).join('\n');
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
    luckText && `LUCK REPORT\n${luckText}`,
    streakText && `STREAKS\n${streakText}`,
    allPlayText && `ALL-PLAY\n${allPlayText}`,
    disputedText && `MOST DISPUTED PICK\n${disputedText}`,
    grudgeText && `THE GRUDGE\n${grudgeText}`,
    historyText && `THIS WEEK IN GRUDGE MATCH HISTORY\n${historyText}`,
    awardText && `AWARDS\n${awardText}`,
    `STANDINGS\n${standingsText}`,
    predictionText && `PREDICTION LEADERS\n${predictionText}`,
    nextText && `COMING UP — WEEK ${recap.week + 1}\n${LOCK_RULE}\n${nextText}`,
    `Full site: ${siteUrl}`,
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}
