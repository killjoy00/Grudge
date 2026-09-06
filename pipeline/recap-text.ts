/**
 * Make the recap's text/plain alternative deliberately scannable.
 *
 * The renderer already emits all of the same information as the HTML email,
 * but a sequence of uppercase headings separated by a single blank line still
 * reads like one long wall of text in plain-text mail clients. This formatter
 * adds structure that does not depend on HTML: a compact masthead, section
 * rules, extra separation between sections, and bullets for matchup notes.
 *
 * It runs after the pickup report is added, so transaction sections get the
 * same treatment as the rest of the letter.
 */

const SECTION_HEADING = /^(?:
  THIS WEEK'S GAMES|
  RECORD WATCH|
  POWER RANKINGS|
  LUCK REPORT|
  STREAKS|
  ALL-PLAY|
  MOST DISPUTED PICK|
  THE GRUDGE|
  THIS WEEK IN GRUDGE MATCH HISTORY|
  AWARDS|
  STANDINGS|
  PREDICTION LEADERS|
  WAIVER PICKUPS|
  10\+ POINT PICKUPS|
  COMING UP — WEEK \d+
)$/x;

const TITLE = /^UNC Grudge Match — (\d{4}) Week (\d+)$/;
const FULL_SITE = /^Full site:\s*(\S+)$/;
const MATCHUP_NOTE = /^  (Surprise:|Worst call:|Decided at )/;

function startSection(lines: string[]) {
  while (lines.at(-1) === '') lines.pop();
  if (lines.length > 0) lines.push('', '');
}

export function formatRecapPlainText(input: string): string {
  const output: string[] = [];

  for (const rawLine of input.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    const title = line.match(TITLE);
    if (title) {
      output.push(
        'UNC GRUDGE MATCH',
        `${title[1]} SEASON · WEEK ${title[2]}`,
        '====================',
        ''
      );
      continue;
    }

    if (SECTION_HEADING.test(line)) {
      startSection(output);
      output.push(line, '--------------------');
      continue;
    }

    const site = line.match(FULL_SITE);
    if (site) {
      startSection(output);
      output.push('FULL SITE', '--------------------', site[1]!);
      continue;
    }

    if (MATCHUP_NOTE.test(line)) {
      output.push(line.replace(/^  /, '  - '));
      continue;
    }

    output.push(line);
  }

  // Three newlines means two visible blank lines between top-level sections;
  // preserve a single blank line inside a section (for example between games).
  return output.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}
