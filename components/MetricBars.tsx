import type { ReactNode } from 'react';

export type MetricBarRow = {
  key: string;
  label: string;
  value: number;
  display?: string;
  href?: string;
  detail?: ReactNode;
};

export function MetricBars({
  rows,
  signed = false,
  empty = 'No data available yet.',
}: {
  rows: MetricBarRow[];
  signed?: boolean;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="note">{empty}</p>;
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((row) => {
        const magnitude = Math.abs(row.value) / max;
        const width = signed ? Math.max(row.value === 0 ? 0 : 2, magnitude * 50) : Math.max(row.value === 0 ? 0 : 2, magnitude * 100);
        const left = signed ? (row.value >= 0 ? 50 : 50 - width) : 0;
        const label = row.href ? <a className="tname" href={row.href}>{row.label}</a> : <strong>{row.label}</strong>;
        return (
          <div key={row.key}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ minWidth: 0, flex: 1 }}>{label}</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{row.display ?? row.value.toLocaleString('en-US')}</strong>
            </div>
            <div
              aria-hidden="true"
              style={{
                position: 'relative', height: 8, marginTop: 5, overflow: 'hidden', borderRadius: 999,
                background: 'color-mix(in srgb, var(--ink) 9%, transparent)',
              }}
            >
              {signed && <span style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'color-mix(in srgb, var(--ink) 28%, transparent)' }} />}
              {width > 0 && (
                <span style={{
                  position: 'absolute', left: `${left}%`, width: `${width}%`, top: 0, bottom: 0,
                  borderRadius: 999, background: row.value < 0 ? 'var(--gold)' : 'var(--accent)',
                }} />
              )}
            </div>
            {row.detail && <div className="tsub" style={{ marginTop: 4 }}>{row.detail}</div>}
          </div>
        );
      })}
    </div>
  );
}
