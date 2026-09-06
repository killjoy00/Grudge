'use client';

import { useState } from 'react';

/**
 * A table whose columns sort on click.
 *
 * Cells carry their own sort value so display and ordering can differ: "14-8"
 * sorts on win percentage, "2005 2006 2007" sorts on the count. Server
 * components cannot hand a client component a render function, so a cell is
 * plain data -- a value, an optional display string, an optional link and
 * sub-line -- and this renders it.
 */

export interface SortColumn {
  key: string;
  label: string;
  /** Right-aligned and sorted high-to-low on first click. */
  numeric?: boolean;
  title?: string;
}

export interface SortCell {
  v: number | string | null;
  d?: string;
  href?: string;
  sub?: string;
  subHref?: string;
  note?: string;
  pill?: 'w' | 'l' | 'warn';
  /**
   * Green for a rise, red for a fall. For columns that are a delta, where the
   * sign is the point -- a pill would be far too loud for a whole column of
   * them, and the plain text alone loses the direction at a glance.
   */
  tone?: 'up' | 'down';
}

export interface SortRow {
  key: string;
  cells: Record<string, SortCell>;
}

function compare(a: SortCell | undefined, b: SortCell | undefined, numeric: boolean) {
  const x = a?.v ?? (numeric ? -Infinity : '');
  const y = b?.v ?? (numeric ? -Infinity : '');
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), undefined, { numeric: true });
}

export default function SortableTable({
  columns, rows, initialSort, rank = true,
}: {
  columns: SortColumn[];
  rows: SortRow[];
  /** Column key the server already ordered by; clicking it first flips it. */
  initialSort?: string;
  rank?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null);

  const sorted = (() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    const numeric = Boolean(column?.numeric);
    const out = [...rows].sort((a, b) => compare(a.cells[sort.key], b.cells[sort.key], numeric));
    return sort.asc ? out : out.reverse();
  })();

  const toggle = (column: SortColumn) => {
    setSort((current) => {
      if (current?.key !== column.key) {
        // Numbers are most useful biggest-first; names A-Z.
        return { key: column.key, asc: !column.numeric };
      }
      return { key: column.key, asc: !current.asc };
    });
  };

  return (
    <div className="scroll">
      <table className="sortable">
        <thead>
          <tr>
            {rank && <th className="rank">#</th>}
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  className={column.numeric ? 'num' : undefined}
                  aria-sort={active ? (sort!.asc ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => toggle(column)}
                    title={column.title ?? `Sort by ${column.label}`}
                    className={`sort-btn${active ? ' active' : ''}`}
                  >
                    {column.label}
                    <span aria-hidden="true" className="sort-caret">
                      {active ? (sort!.asc ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={row.key}>
              {rank && <td className="rank">{index + 1}</td>}
              {columns.map((column) => {
                const cell = row.cells[column.key];
                const text = cell?.d ?? (cell?.v === null || cell?.v === undefined ? '—' : String(cell.v));
                const body = cell?.pill
                  ? <span className={`pill ${cell.pill}`}>{text}</span>
                  : cell?.href
                    ? <a href={cell.href} className="tname">{text}</a>
                    : cell?.tone
                      ? <span className={cell.tone}>{text}</span>
                      : column.numeric ? text : <span className="tname">{text}</span>;
                return (
                  <td key={column.key} className={column.numeric ? 'num' : undefined}>
                    {body}
                    {cell?.sub && (
                      cell.subHref
                        ? <span className="tsub block"><a href={cell.subHref}>{cell.sub}</a></span>
                        : <span className="tsub block">{cell.sub}</span>
                    )}
                    {cell?.note && <span className="tsub block">{cell.note}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
