'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { WeekPickReveal, type PickRevealMatchup, type RevealedPick } from './WeekPickReveal.tsx';

/** Authenticated locked-pick reveal on a public, week-cached scoreboard. */
export function HomeMemberPanel({
  season, week, matchups, lockAt,
}: {
  season: number;
  week: number;
  matchups: PickRevealMatchup[];
  lockAt: string | null;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const [clock, setClock] = useState<number | null>(null);
  const [picks, setPicks] = useState<RevealedPick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The cache spans Saturday's lock; the database enforces write deadlines.
  useEffect(() => setClock(Date.now()), []);
  const locked = clock !== null && lockAt !== null && new Date(lockAt).getTime() <= clock;

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !locked) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ kind: 'picks', season: String(season), week: String(week) });
        const response = await fetch(`/api/home-member?${query}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Could not load locked league picks.');
        const payload = await response.json() as { data: RevealedPick[] };
        if (!controller.signal.aborted) setPicks(payload.data);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load picks.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [isLoaded, isSignedIn, locked, season, week]);

  if (!locked || !isLoaded || !isSignedIn) return null;
  return <>
    <h2>Everyone&rsquo;s picks</h2>
    {loading && picks.length === 0 ? <p className="note">Loading the locked board…</p> :
      <WeekPickReveal matchups={matchups} picks={picks} />}
    {error && <p className="err">{error}</p>}
  </>;
}
