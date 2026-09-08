'use client';
export default function PlayerError({reset}: {reset: () => void}) {
  return <div className="card empty-state"><strong>The player ledger couldn&rsquo;t load</strong>
    <span>Please try again in a moment.</span><button onClick={reset}>Try again</button></div>;
}
