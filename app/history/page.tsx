import SortableTable, { type SortColumn, type SortRow } from '../../components/SortableTable.tsx';
import { getCachedRichChampions } from '../../lib/history-cache.ts';
import { franchiseHref, managerHref, record, seasonHref, winRate } from '../../lib/history-format.ts';
import { getCachedHistoryDirectory } from '../../lib/history-overview-cache.ts';
import { getSeasonManagers } from '../../lib/history-queries.ts';
import { getCurrentSeason } from '../../lib/queries.ts';
import { getCachedRegularSeasonChampions } from '../../lib/regular-season-history.ts';

export const dynamic = 'force-dynamic';

const franchiseColumns: SortColumn[] = [
  { key: 'name', label: 'Franchise' },
  { key: 'seasons', label: 'Seasons', numeric: true },
  { key: 'regular', label: 'Regular', numeric: true },
  { key: 'winPct', label: 'Win %', numeric: true },
  { key: 'firsts', label: 'Reg. Champ.', numeric: true, title: 'Sort by regular-season championships' },
  { key: 'playoffs', label: 'Playoffs', numeric: true },
  { key: 'titles', label: 'Titles', numeric: true },
];

const managerColumns: SortColumn[] = [
  { key: 'name', label: 'Manager' },
  { key: 'seasons', label: 'Seasons', numeric: true },
  { key: 'regular', label: 'Regular', numeric: true },
  { key: 'winPct', label: 'Win %', numeric: true },
  { key: 'firsts', label: 'Reg. Champ.', numeric: true, title: 'Sort by regular-season championships' },
  { key: 'playoffs', label: 'Playoffs', numeric: true },
  { key: 'titles', label: 'Titles', numeric: true },
];

const archiveColumns: SortColumn[] = [
  { key: 'season', label: 'Season', numeric: true },
  { key: 'champion', label: 'Champion' },
  { key: 'runnerUp', label: 'Runner-up' },
  { key: 'regular', label: 'Regular-season champion' },
];

function groupSeasons(rows: Array<{ season: number; key: string | null }>) {
  const out = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.key) continue;
    const list = out.get(row.key) ?? [];
    list.push(row.season);
    out.set(row.key, list);
  }
  return out;
}

function firstCell(seasons: number[] | undefined) {
  const list = [...(seasons ?? [])].sort((a, b) => a - b);
  return {
    v: list.length,
    d: String(list.length),
    sub: list.length ? list.join(' ') : undefined,
  };
}

export default async function History() {
  const currentSeason = await getCurrentSeason();
  const [[franchises, managers], champions, regularSeasonChampions, currentSeasonManagers] = await Promise.all([
    getCachedHistoryDirectory(),
    getCachedRichChampions(),
    getCachedRegularSeasonChampions(),
    getSeasonManagers(currentSeason),
  ]);
  const first = champions.at(-1)?.season ?? null;
  const last = champions[0]?.season ?? null;
  const regularBySeason = new Map(regularSeasonChampions.map((row) => [row.season, row]));

  const currentManagerKeys = new Set(currentSeasonManagers.map((row) => row.manager_key));
  if (currentManagerKeys.size === 0) {
    const latestManagerSeason = Math.max(0, ...managers.map((row) => row.last_season));
    for (const row of managers) if (row.last_season === latestManagerSeason) currentManagerKeys.add(row.manager_key);
  }

  const franchiseFirsts = groupSeasons(
    regularSeasonChampions.map((row) => ({ season: row.season, key: row.franchise_key }))
  );
  const managerFirsts = groupSeasons(
    regularSeasonChampions.map((row) => ({ season: row.season, key: row.manager_key }))
  );

  const franchiseRows: SortRow[] = franchises.map((row) => {
    const rate = winRate(row.regular_wins, row.regular_losses, row.regular_ties);
    return {
      key: row.franchise_key,
      cells: {
        name: { v: row.current_name, d: row.current_name, href: franchiseHref(row.franchise_key), sub: `${row.first_season}–${row.last_season}` },
        seasons: { v: row.seasons },
        regular: { v: row.regular_wins, d: record(row.regular_wins, row.regular_losses, row.regular_ties) },
        winPct: { v: rate, d: (rate * 100).toFixed(1) },
        firsts: firstCell(franchiseFirsts.get(row.franchise_key)),
        playoffs: { v: row.playoff_wins, d: `${row.playoff_wins}-${row.playoff_losses}`, sub: `${row.playoff_appearances} berths` },
        titles: { v: row.championships, d: String(row.championships), sub: row.title_seasons ?? undefined },
      },
    };
  });

  const managerRow = (row: (typeof managers)[number]): SortRow => {
    const rate = winRate(row.regular_wins, row.regular_losses, row.regular_ties);
    return {
      key: row.manager_key,
      cells: {
        name: { v: row.display_name, d: row.display_name, href: managerHref(row.manager_key), sub: `${row.first_season}–${row.last_season}` },
        seasons: { v: row.seasons },
        regular: { v: row.regular_wins, d: record(row.regular_wins, row.regular_losses, row.regular_ties) },
        winPct: { v: rate, d: (rate * 100).toFixed(1) },
        firsts: firstCell(managerFirsts.get(row.manager_key)),
        playoffs: { v: row.playoff_wins, d: `${row.playoff_wins}-${row.playoff_losses}`, sub: `${row.playoff_appearances} berths` },
        titles: { v: row.championships, d: String(row.championships), sub: row.title_seasons ?? undefined },
      },
    };
  };

  const currentManagerRows = managers.filter((row) => currentManagerKeys.has(row.manager_key)).map(managerRow);
  const formerManagerRows = managers.filter((row) => !currentManagerKeys.has(row.manager_key)).map(managerRow);

  const archiveRows: SortRow[] = champions.map((row) => {
    const regular = regularBySeason.get(row.season);
    return {
      key: String(row.season),
      cells: {
        season: { v: row.season, d: String(row.season), href: seasonHref(row.season) },
        champion: {
          v: row.champion_team_name,
          d: row.champion_team_name,
          href: franchiseHref(row.champion_key),
          sub: row.champion_manager ?? undefined,
          subHref: row.champion_manager_key && row.champion_manager
            ? managerHref(row.champion_manager_key)
            : undefined,
        },
        runnerUp: row.runner_up_key && row.runner_up_team_name
          ? { v: row.runner_up_team_name, d: row.runner_up_team_name, href: franchiseHref(row.runner_up_key) }
          : { v: null, d: '—' },
        regular: regular
          ? { v: regular.team_name, d: regular.team_name, href: franchiseHref(regular.franchise_key) }
          : { v: null, d: '—' },
      },
    };
  });

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">The permanent record</div>
        <h1>League history</h1>
        <p>Every season, permanent franchise and manager in one archive.</p>
      </div>

      <div className="stat-strip">
        <div><strong>{first && last ? `${first}–${last}` : '—'}</strong><span>League span</span></div>
        <div><strong>{champions.length}</strong><span>Seasons played</span></div>
        <div><strong>{franchises.length}</strong><span>Permanent franchises</span></div>
        <div><strong>{managers.length}</strong><span>Managers on record</span></div>
      </div>

      <nav aria-label="Explore league history" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '22px 0 30px' }}>
        <a className="btn btn-quiet" href="/history/rivalries">Manager grudges →</a>
        <a className="btn btn-quiet" href="/history/drafts">Draft history →</a>
        <a className="btn btn-quiet" href="/history/records">Record book →</a>
      </nav>

      <h2>Franchises</h2>
      <p className="sub">A franchise is the permanent league slot. Names and managers can change without resetting the record.</p>
      <div className="card">
        <SortableTable columns={franchiseColumns} rows={franchiseRows} rank={false} />
      </div>

      <h2>Managers</h2>
      <p className="sub">Career records follow the person across franchise changes. Current managers are kept together here.</p>
      <div className="card">
        <SortableTable columns={managerColumns} rows={currentManagerRows} rank={false} />
      </div>

      <h2>Season archive</h2>
      <div className="card">
        <SortableTable columns={archiveColumns} rows={archiveRows} rank={false} />
        <p className="note" style={{ margin: '10px 2px 0' }}>
          Source: 2005–2017 season results come from the commissioner archive; 2018–2025 season results come from ESPN&rsquo;s archived league records.
        </p>
      </div>

      {formerManagerRows.length > 0 && (
        <>
          <h2>Former managers</h2>
          <p className="sub">Past managers stay in the record, separated from the current league directory.</p>
          <div className="card">
            <SortableTable columns={managerColumns} rows={formerManagerRows} rank={false} />
          </div>
        </>
      )}

      <h2>About the archive</h2>
      <div className="callout">
        <p style={{ marginTop: 0 }}>
          Weekly team scoreboards and draft boards are on file for every played season back to 2005. Player-level weekly lineups and transaction history are only available where ESPN still preserves them, and the site never fills those gaps with invented data.
        </p>
        <a href="/history/vault"><strong>See data coverage and source material →</strong></a>
      </div>
    </>
  );
}
