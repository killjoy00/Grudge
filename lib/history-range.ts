export interface HistoryRange {
  from: number;
  to: number;
}

/** Normalize optional URL years against the seasons the archive actually has. */
export function historyRange(
  fromParam: string | undefined,
  toParam: string | undefined,
  first: number | null,
  last: number | null
): HistoryRange | null {
  if ((!fromParam && !toParam) || first === null || last === null) return null;
  const parsedFrom = fromParam ? Number(fromParam) : Number.NaN;
  const parsedTo = toParam ? Number(toParam) : Number.NaN;
  let from = Number.isInteger(parsedFrom) ? parsedFrom : first;
  let to = Number.isInteger(parsedTo) ? parsedTo : last;
  from = Math.max(first, Math.min(last, from));
  to = Math.max(first, Math.min(last, to));
  return from <= to ? { from, to } : { from: to, to: from };
}
