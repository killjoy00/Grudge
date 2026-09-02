/**
 * The year selector that sits under every season-scoped page.
 *
 * Standings had one and the rankings and odds pages did not, so those two
 * offered a single "see last season" link and no way to reach any other year.
 * One component, so a page cannot quietly go without it again.
 *
 * `seasons` is whatever that page actually has data for -- champions for the
 * standings, played weeks for the rankings, simulated weeks for the odds --
 * because a year chip that leads to an empty page is worse than no chip.
 */
export function SeasonPicker({
  seasons, current, basePath, heading = 'Other seasons',
  note = 'The league did not play in 2020.',
}: {
  seasons: number[];
  /** The season being shown, highlighted. May not be in the list (a preseason year). */
  current: number;
  /** e.g. "/standings" */
  basePath: string;
  heading?: string;
  /**
   * The footnote under the chips. The 2020 gap is the right thing to say on
   * every page that lists the league's seasons; a page listing only the years
   * that have a particular KIND of record -- trades, say -- passes its own,
   * because a missing 2020 there means something different.
   */
  note?: string | null;
}) {
  if (seasons.length === 0) return null;
  return (
    <div className="card">
      <strong style={{ fontSize: 14 }}>{heading}</strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {seasons.map((s) => (
          <a key={s} href={`${basePath}?season=${s}`}
             className={`btn${s === current ? '' : ' btn-quiet'}`}
             style={{ padding: '6px 12px' }}>
            {s}
          </a>
        ))}
      </div>
      {note && <p className="note" style={{ marginTop: 10 }}>{note}</p>}
    </div>
  );
}
