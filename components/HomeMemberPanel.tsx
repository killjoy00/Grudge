'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { Comments, type Comment } from './Comments.tsx';
import { WeekPickReveal, type PickRevealMatchup, type RevealedPick } from './WeekPickReveal.tsx';

type Kind = 'comments' | 'picks';

/**
 * Small authenticated island on a public, week-long CDN-cached scoreboard.
 * Anonymous visitors never invoke the database API. Private league details
 * are fetched only after Clerk has established a signed-in user in the browser.
 */
export function HomeMemberPanel({
  kind, season, week, matchups = [], lockAt = null,
}: {
  kind: Kind;
  season: number;
  week: number;
  matchups?: PickRevealMatchup[];
  lockAt?: string | null;
}) {
  const { isLoaded, isSignedIn, user } = useUser();
  const [clock, setClock] = useState<number | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [picks, setPicks] = useState<RevealedPick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Lock state is derived client-side, because the scoreboard HTML is cached
  // across Saturday's deadline. The database independently enforces the lock.
  useEffect(() => setClock(Date.now()), []);
  const locked = clock !== null && lockAt !== null && new Date(lockAt).getTime() <= clock;
  const shouldLoad = kind === 'comments' || locked;

  const reload = useCallback(async (signal?: AbortSignal) => {
    if (!isLoaded || !isSignedIn || !shouldLoad) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ kind, season: String(season), week: String(week) });
      const response = await fetch(`/api/home-member?${query}`, {
        credentials: 'same-origin', cache: 'no-store', signal,
      });
      if (!response.ok) throw new Error('Could not load league member details.');
      const payload = await response.json() as { data: Comment[] | RevealedPick[] };
      if (signal?.aborted) return;
      if (kind === 'comments') setComments(payload.data as Comment[]);
      else setPicks(payload.data as RevealedPick[]);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Could not load details.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [isLoaded, isSignedIn, shouldLoad, kind, season, week]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  if (kind === 'picks') {
    if (!locked || !isLoaded || !isSignedIn) return null;
    return <>
      <h2>Everyone&rsquo;s picks</h2>
      {loading && picks.length === 0 ? <p className="note">Loading the locked board…</p> :
        <WeekPickReveal matchups={matchups} picks={picks} />}
      {error && <p className="err">{error}</p>}
    </>;
  }

  if (!isLoaded) return null;
  if (!isSignedIn) return <Comments season={season} week={week} comments={[]} me={null} />;
  if (loading && comments.length === 0) return <div className="card"><h2>Talk</h2><p className="note">Loading comments…</p></div>;
  return <>
    <Comments season={season} week={week} comments={comments} me={user?.id ?? null}
      onRefresh={() => { void reload(); }} />
    {error && <p className="err">{error}</p>}
  </>;
}
