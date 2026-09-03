/**
 * Free-agent pool analysis.
 *
 * The useful column here is the ownership GAP, not projected points. Everyone
 * in the league already sees ESPN's projections in ESPN's own UI, so ranking by
 * them surfaces nothing new. "73% of ESPN owns this player and he is still on
 * our waiver wire" is information the UI does not show anywhere.
 *
 * Two trend numbers are shown side by side on purpose -- ESPN's own weekly
 * delta, and the one computed from our previous snapshot. They measure the same
 * thing from independent data, so a disagreement means our capture cadence
 * slipped. One number alone would have looked perfectly plausible while being
 * wrong.
 */
import { getPool, getPoolOpportunities, getSnapshotCoverage } from '../../../lib/admin-queries.ts';
import { getCurrentSeason } from '../../../lib/queries.ts';
import { adminProfile } from '../../../lib/admin.ts';
import { notFound } from 'next/navigation';
import SortableTable from '../../../components/SortableTable.tsx';
import type { SortColumn, SortRow } from '../../../components/SortableTable.tsx';

export const dynamic = 'force-dynamic';

/**
 * A delta as a sortable cell.
 *
 * The sort value is the number, never the text: sorting "flat" and "+3.1" as
 * strings would put every unchanged player between the risers and the fallers.
 * A missing value sorts to the bottom rather than reading as zero, because "we
 * have no second snapshot yet" is not the same as "did not move".
 */
function deltaCell(v: string | null) {
  if (v === null) return { v: null, d: '—' };
  const n = Number(v);
  if (Math.abs(n) < 0.05) return { v: n, d: 'flat' };
  return { v: n, d: `${n > 0 ? '+' : ''}${n.toFixed(1)}`, tone: n > 0 ? 'up' as const : 'down' as const };
}

/** Percent as a sortable cell: sorts on the number, shows one decimal. */
function pctCell(v: string | null) {
  return v === null ? { v: null, d: '—' } : { v: Number(v), d: `${Number(v).toFixed(1)}%` };
}

const OPPORTUNITY_COLUMNS: SortColumn[] = [
  { key: 'player', label: 'Player' },
  { key: 'pos', label: 'Pos' },
  { key: 'owned', label: 'Owned', numeric: true, title: 'Sort by percent of ESPN leagues rostering him' },
  { key: 'started', label: 'Started', numeric: true },
  { key: 'espn', label: 'ESPN \u0394', numeric: true, title: "Sort by ESPN's own weekly ownership change" },
];

const POOL_COLUMNS: SortColumn[] = [
  { key: 'player', label: 'Player' },
  { key: 'pos', label: 'Pos' },
  { key: 'owned', label: 'Owned', numeric: true },
  { key: 'espn', label: 'ESPN \u0394', numeric: true },
  { key: 'ours', label: 'Ours \u0394', numeric: true },
  { key: 'value', label: '$', numeric: true, title: 'Sort by average auction value' },
  { key: 'status', label: 'Status' },
];

export default async function Pool({
  searchParams,
}: { searchParams: Promise<{ week?: string }> }) {
  if (!(await adminProfile())) notFound();
  const season = await getCurrentSeason();
  const coverage = await getSnapshotCoverage(season);
  const sp = await searchParams;
  const week = Number(sp.week) || coverage[0]?.week;

  if (!week) {
    return (
      <>
        <h1>Free agents</h1>
        <div className="card">
          <p className="empty">
            No ownership snapshots captured yet for {season}.
          </p>
          <p className="note">
            The weekly job writes one every Tuesday. The first snapshot gives a
            ranking; the second is when trends start working, because a trend
            needs two observations and there is no way to fake the first one.
          </p>
        </div>
      </>
    );
  }

  const [opportunities, pool] = await Promise.all([
    getPoolOpportunities(season, week),
    getPool(season, week),
  ]);

  const haveTrend = pool.some((p) => p.our_percent_change !== null);

  const opportunityRows: SortRow[] = opportunities.map((p) => ({
    key: String(p.espn_player_id),
    cells: {
      player: { v: p.full_name ?? '' },
      pos: { v: p.position ?? '' },
      owned: pctCell(p.percent_owned),
      started: pctCell(p.percent_started),
      espn: deltaCell(p.espn_percent_change),
    },
  }));

  const poolRows: SortRow[] = pool.map((p) => ({
    key: String(p.espn_player_id),
    cells: {
      player: { v: p.full_name ?? '' },
      pos: { v: p.position ?? '' },
      owned: pctCell(p.percent_owned),
      espn: deltaCell(p.espn_percent_change),
      ours: deltaCell(p.our_percent_change),
      value: p.auction_value_avg === null
        ? { v: null, d: '—' }
        : { v: Number(p.auction_value_avg), d: Number(p.auction_value_avg).toFixed(1) },
      status: { v: p.status ?? '—' },
    },
  }));

  return (
    <>
      <h1>Free agents</h1>
      <p className="sub">
        {season} · week {week} · {pool.length} in the pool
      </p>

      {coverage.length > 1 && (
        <div className="tabs" style={{ padding: '0 0 10px' }}>
          {coverage.map((c) => (
            <a key={c.week} href={`/admin/pool?week=${c.week}`} className={c.week === week ? 'on' : ''}>
              Wk {c.week}
            </a>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Widely owned, still available</h2>
        <p className="note">
          Ranked by how much of ESPN owns them, not by projection. These are the
          players the rest of the platform rates that nobody here has claimed.
        </p>
        <SortableTable
          columns={OPPORTUNITY_COLUMNS}
          rows={opportunityRows}
          initialSort="owned"
        />
      </div>

      <div className="card">
        <h2>Full pool</h2>
        {!haveTrend && (
          <p className="note">
            The <em>ours</em> column is empty because this is the first snapshot of the
            season — a week-over-week change needs a previous week to compare against.
            It fills in from the next capture onward.
          </p>
        )}
        <SortableTable
          columns={POOL_COLUMNS}
          rows={poolRows}
          initialSort="owned"
        />
        <p className="note">
          Status is whatever ESPN returned, uninterpreted. Every player observed so far
          has come back <code>WAIVERS</code>; <code>FREEAGENT</code> is requested by the
          filter but has never actually appeared in a response for this league, so it is
          not treated as a known value anywhere in the pipeline.
        </p>
      </div>
    </>
  );
}
