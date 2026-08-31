/**
 * Connection-string validation.
 *
 * Kept out of db.ts, which carries `import 'server-only'` and therefore cannot
 * be imported by a test. This is a pure function over a string with no server
 * dependencies, and both the web app and the pipeline need it.
 */
/**
 * Explain what is wrong with a connection string, or null if it looks usable.
 *
 * NEVER returns the value itself, or any part of it: it carries a password, and
 * this message ends up in build logs that are far more widely readable than the
 * secret store the value came from. Only structural facts about it.
 *
 * This exists because the driver's own rejection is close to useless. A
 * malformed value produced:
 *
 *   Error: Database connection string format for `neon()` should be:
 *     ***host.tld/dbname?option=value
 *
 * from inside a prerender, with the offending value masked by the CI log
 * scrubber, no mention of WHICH variable was at fault, and a stack pointing at
 * webpack chunks. Three builds failed on that before the cause was clear.
 *
 * The mistakes below are the ones Neon's own dashboard invites: its connection
 * snippets are offered in psql, .env and framework flavours, and copying the
 * wrong flavour whole is far easier than copying the bare URL.
 */
export function describeUrlProblem(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return 'it is empty or only whitespace';
  if (/^["'].*["']$/.test(value)) {
    return 'it is wrapped in quotes — paste the bare URL, secret stores do not strip them';
  }
  if (/^psql\s/i.test(value)) {
    return 'it starts with "psql " — that is a shell command, not a connection string';
  }
  if (/^[A-Z_][A-Z0-9_]*=/i.test(value)) {
    return 'it includes a "NAME=" prefix — paste only the part after the equals sign';
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'it is not a URL — it should begin with postgresql://';
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    return `its scheme is "${parsed.protocol.replace(':', '')}" — it should be postgresql`;
  }
  if (!parsed.hostname) return 'it has no host';
  if (parsed.pathname.replace(/^\//, '') === '') return 'it names no database after the host';
  return null;
}
