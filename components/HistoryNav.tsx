export function HistoryNav(_: { current?: 'overview' | 'records' | 'rivalries' | 'vault' } = {}) {
  return (
    <nav aria-label="League history" style={{ margin: '0 0 24px' }}>
      <a className="btn btn-quiet" href="/history">← League history</a>
    </nav>
  );
}
