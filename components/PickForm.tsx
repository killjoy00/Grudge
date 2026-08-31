'use client';
import { useState, useTransition } from 'react';
import { submitPick } from '../lib/actions.ts';

export interface Matchup {
  espn_matchup_id: number;
  home_team_id: number; home_name: string;
  away_team_id: number; away_name: string;
}

export function PickForm({
  season, week, matchups, initial, locked,
}: {
  season: number; week: number; matchups: Matchup[];
  initial: Record<number, number>; locked: boolean;
}) {
  const [picks, setPicks] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [pending, start] = useTransition();

  function choose(matchupId: number, teamId: number) {
    if (locked) return;
    const previous = picks[matchupId];
    setPicks((p) => ({ ...p, [matchupId]: teamId })); // optimistic
    setErr(null);
    start(async () => {
      const res = await submitPick(season, week, matchupId, teamId);
      if (!res.ok) {
        // Roll back so the UI never claims a pick the database refused.
        setPicks((p) => {
          const next = { ...p };
          if (previous === undefined) delete next[matchupId];
          else next[matchupId] = previous;
          return next;
        });
        setErr(res.error ?? 'Could not save that pick.');
      } else {
        setSaved(matchupId);
        setTimeout(() => setSaved((s) => (s === matchupId ? null : s)), 1800);
      }
    });
  }

  return (
    <div>
      {matchups.map((m) => (
        <div key={m.espn_matchup_id} style={{ marginBottom: 14 }}>
          <div className="pickrow">
            {[
              [m.away_team_id, m.away_name],
              [m.home_team_id, m.home_name],
            ].map(([id, name]) => (
              <button
                key={id as number}
                className={`pick ${picks[m.espn_matchup_id] === id ? 'on' : ''}`}
                disabled={locked || pending}
                onClick={() => choose(m.espn_matchup_id, id as number)}
              >
                {name as string}
              </button>
            ))}
          </div>
          {saved === m.espn_matchup_id && <div className="ok">Saved</div>}
        </div>
      ))}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
