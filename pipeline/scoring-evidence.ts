/** Resolve copies of one score without treating ownership as multiple production. */
export function classifyScoreCopies(copies: (number | null)[]) {
  const values = [...new Set(copies.filter((n): n is number => n !== null && Number.isFinite(n)))].sort((a, b) => a - b);
  const conflict = values.length > 1 && values.at(-1)! - values[0]! > 0.001;
  return { values, points: conflict || !values.length ? null : values[0]!,
    evidence: conflict ? 'conflict' as const : !values.length ? 'missing' as const : 'observed' as const };
}
