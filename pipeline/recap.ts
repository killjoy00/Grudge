/** Pure formatting helpers for the Tuesday recap email. */

export interface RecapGame {
  away_name: string;
  away_points: string | null;
  home_name: string;
  home_points: string | null;
  winner: 'HOME' | 'AWAY' | 'TIE' | string;
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

export interface WeeklyRecap {
  season: number;
  week: number;
  games: RecapGame[];
  awards: RecapAward[];
  bench: RecapBenchRow[];
  standings: RecapStanding[];
  predictions: RecapPredictionRow[];
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
  nailbiter: 'Closest game',
  worst_bench: 'Worst bench decision',
};

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

function normalizeSiteUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('RECAP_SITE_URL must use HTTPS.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function renderWeeklyRecap(recap: WeeklyRecap, rawSiteUrl: string): RenderedRecap {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const subject = `UNC Grudge Match — Week ${recap.week} recap`;
  const border = 'border-bottom:1px solid #e5e7eb;padding:9px 6px;';

  const gamesHtml = recap.games.map((game) => {
    const away = game.winner === 'AWAY' ? `<strong>${escapeHtml(game.away_name)}</strong>` : escapeHtml(game.away_name);
    const home = game.winner === 'HOME' ? `<strong>${escapeHtml(game.home_name)}</strong>` : escapeHtml(game.home_name);
    return `<tr><td style="${border}">${away}</td><td style="${border}text-align:right">${escapeHtml(game.away_points ?? '—')}</td>` +
      `<td style="${border}color:#6b7280;text-align:center">at</td><td style="${border}">${home}</td>` +
      `<td style="${border}text-align:right">${escapeHtml(game.home_points ?? '—')}</td></tr>`;
  }).join('');

  const awardsHtml = recap.awards.map((award) =>
    `<tr><td style="${border}">${escapeHtml(AWARD_LABELS[award.award_key] ?? award.award_key)}</td>` +
    `<td style="${border}"><strong>${escapeHtml(award.name ?? '—')}</strong></td>` +
    `<td style="${border}text-align:right">${escapeHtml(award.value)}</td></tr>`
  ).join('');

  const benchHtml = recap.bench.slice(0, 3).map((row) =>
    `<tr><td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
    `<td style="${border}text-align:right">${escapeHtml(row.points_for)}</td>` +
    `<td style="${border}text-align:right">${escapeHtml(row.optimal_points ?? '—')}</td>` +
    `<td style="${border}text-align:right">${escapeHtml(row.points_left_on_bench ?? '—')}</td></tr>`
  ).join('');

  const standingsHtml = recap.standings.slice(0, 10).map((row, index) =>
    `<tr><td style="${border}color:#6b7280">${index + 1}</td><td style="${border}"><strong>${escapeHtml(row.name)}</strong></td>` +
    `<td style="${border}text-align:right">${escapeHtml(record(row))}</td>` +
    `<td style="${border}text-align:right">${escapeHtml(row.points_for)}</td></tr>`
  ).join('');

  const predictionsHtml = recap.predictions.length ? `
    <h2 style="font-size:18px;margin:28px 0 8px">Prediction leaders</h2>
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><th style="${border}text-align:left">Member</th><th style="${border}text-align:right">Correct</th><th style="${border}text-align:right">Accuracy</th></tr>
      ${recap.predictions.slice(0, 3).map((row) =>
        `<tr><td style="${border}"><strong>${escapeHtml(row.display_name ?? 'League member')}</strong></td>` +
        `<td style="${border}text-align:right">${row.correct}</td><td style="${border}text-align:right">${accuracy(row.accuracy)}</td></tr>`
      ).join('')}
    </table>` : '';

  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;color:#17191f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">Scores, awards, bench mistakes, and standings from Week ${recap.week}.</div>
  <div style="max-width:680px;margin:0 auto;padding:24px 14px">
    <div style="background:#111827;color:white;border-radius:12px 12px 0 0;padding:24px">
      <div style="color:#93c5fd;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">UNC Grudge Match</div>
      <h1 style="font-size:28px;margin:5px 0 0">Week ${recap.week} recap</h1>
      <div style="color:#cbd5e1;margin-top:4px">${recap.season} season</div>
    </div>
    <div style="background:white;border-radius:0 0 12px 12px;padding:24px">
      <h2 style="font-size:18px;margin:0 0 8px">Results</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${gamesHtml}</table>
      ${recap.awards.length ? `<h2 style="font-size:18px;margin:28px 0 8px">Awards</h2><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${awardsHtml}</table>` : ''}
      ${recap.bench.length ? `<h2 style="font-size:18px;margin:28px 0 8px">Bench watch</h2><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="${border}text-align:left">Team</th><th style="${border}text-align:right">Actual</th><th style="${border}text-align:right">Best</th><th style="${border}text-align:right">Wasted</th></tr>${benchHtml}</table>` : ''}
      <h2 style="font-size:18px;margin:28px 0 8px">Standings</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="${border}"></th><th style="${border}text-align:left">Team</th><th style="${border}text-align:right">Record</th><th style="${border}text-align:right">Points</th></tr>${standingsHtml}</table>
      ${predictionsHtml}
      <p style="margin:30px 0 8px;text-align:center"><a href="${escapeHtml(siteUrl)}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Open the full recap</a></p>
      <p style="color:#6b7280;font-size:12px;text-align:center;margin:20px 0 0">Sent to members of the UNC Grudge Match fantasy league.</p>
    </div>
  </div>
</body></html>`;

  const gameText = recap.games.map((game) =>
    `${game.away_name} ${game.away_points ?? '—'} at ${game.home_name} ${game.home_points ?? '—'}`
  ).join('\n');
  const awardText = recap.awards.map((award) =>
    `${AWARD_LABELS[award.award_key] ?? award.award_key}: ${award.name ?? '—'} (${award.value})`
  ).join('\n');
  const benchText = recap.bench.slice(0, 3).map((row) =>
    `${row.name}: ${row.points_left_on_bench ?? '—'} points left on bench`
  ).join('\n');
  const standingsText = recap.standings.slice(0, 10).map((row, index) =>
    `${index + 1}. ${row.name} — ${record(row)}, ${row.points_for} points`
  ).join('\n');
  const predictionText = recap.predictions.slice(0, 3).map((row, index) =>
    `${index + 1}. ${row.display_name ?? 'League member'} — ${row.correct} correct (${accuracy(row.accuracy)})`
  ).join('\n');

  const text = [
    `UNC Grudge Match — ${recap.season} Week ${recap.week}`,
    `RESULTS\n${gameText}`,
    awardText && `AWARDS\n${awardText}`,
    benchText && `BENCH WATCH\n${benchText}`,
    `STANDINGS\n${standingsText}`,
    predictionText && `PREDICTION LEADERS\n${predictionText}`,
    `Full recap: ${siteUrl}`,
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}
