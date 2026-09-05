const LINKS = [
  ['/history', 'Overview'],
  ['/history/records', 'Records'],
  ['/history/rivalries', 'Rivalries'],
  ['/history/vault', 'The Vault'],
] as const;

export function HistoryNav({ current }: { current?: 'overview' | 'records' | 'rivalries' | 'vault' }) {
  const keys = ['overview', 'records', 'rivalries', 'vault'] as const;
  return (
    <nav aria-label="League history" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 24px' }}>
      {LINKS.map(([href, label], index) => (
        <a
          key={href}
          href={href}
          className={`btn ${current === keys[index] ? '' : 'btn-quiet'}`}
          aria-current={current === keys[index] ? 'page' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
