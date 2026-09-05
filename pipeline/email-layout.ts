import type { RenderedRecap, WeeklyRecap, RecapGame } from './recap.ts';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Mirror the score-row markup emitted by renderWeeklyRecap so we can replace
 * just those two rows with old-school table markup. Flexbox support in email
 * clients is inconsistent; a presentation table gives the team name and score
 * a guaranteed visual gap instead of occasionally collapsing them together.
 */
function legacySide(name: string, points: string | null, won: boolean): string {
  return `<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;` +
    `${won ? 'font-weight:700' : 'color:#4b5563'}">` +
    `<span>${won ? '▸ ' : '&nbsp;&nbsp;&nbsp;'}${escapeHtml(name)}</span>` +
    `<span>${escapeHtml(points ?? '—')}</span></div>`;
}

function scoreRow(name: string, points: string | null, won: boolean): string {
  const emphasis = won ? 'font-weight:700' : 'color:#4b5563';
  return `<tr>` +
    `<td style="padding:2px 16px 2px 0;${emphasis}">${escapeHtml(name)}</td>` +
    `<td style="padding:2px 0 2px 16px;text-align:right;white-space:nowrap;${emphasis}">` +
    `${escapeHtml(points ?? '—')}</td>` +
    `</tr>`;
}

function orderedSides(game: RecapGame): Array<{ name: string; points: string | null; won: boolean }> {
  const away = { name: game.away_name, points: game.away_points, won: game.winner === 'AWAY' };
  const home = { name: game.home_name, points: game.home_points, won: game.winner === 'HOME' };
  if (game.winner === 'HOME') return [home, away];
  if (game.winner === 'AWAY') return [away, home];
  return [away, home];
}

/**
 * Email-only compatibility pass for matchup score rows.
 *
 * - winner first (home/away is irrelevant in the recap)
 * - winner remains bold for quick scanning
 * - no arrow glyph is needed once ordering conveys the result
 * - table cells/padding keep the team name and score separated in Gmail and
 *   other clients that do not reliably honor flexbox gap/justification
 *
 * The replacement is intentionally best-effort. If the shared recap renderer
 * changes later, a missed marker should not block the weekly email from being
 * sent; the regression test will flag that the compatibility pass needs to be
 * updated.
 */
export function makeMatchupsEmailSafe(
  rendered: RenderedRecap,
  recap: WeeklyRecap
): RenderedRecap {
  let html = rendered.html;
  let text = rendered.text;

  for (const game of recap.games) {
    const awayWon = game.winner === 'AWAY';
    const homeWon = game.winner === 'HOME';
    const legacy = `${legacySide(game.away_name, game.away_points, awayWon)}\n      ` +
      `${legacySide(game.home_name, game.home_points, homeWon)}`;

    const rows = orderedSides(game);
    const replacement = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
      `style="width:100%;border-collapse:collapse;font-size:14px">` +
      `${rows.map((row) => scoreRow(row.name, row.points, row.won)).join('')}` +
      `</table>`;
    html = html.replace(legacy, replacement);

    if (game.winner === 'HOME' || game.winner === 'AWAY') {
      const legacyText = `${game.away_name} ${game.away_points ?? '—'} at ` +
        `${game.home_name} ${game.home_points ?? '—'}`;
      const orderedText = rows
        .map((row) => `${row.name} ${row.points ?? '—'}`)
        .join('\n');
      text = text.replace(legacyText, orderedText);
    }
  }

  return { ...rendered, html, text };
}
