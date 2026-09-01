'use client';
import { useState, useTransition } from 'react';
import { submitPick } from '../lib/actions.ts';

export interface Matchup {
  espn_matchup_id: number;
  home_team_id: number; home_name: string; home_owners: string | null;
  away_team_id: number; away_name: string; away_owners: string | null;
}

/**
 * One card per matchup, two sides and a VS between them, so the week reads as
 * five head-to-head games rather than a list of ten team names.
 */
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

  const made = matchups.filter((m) => picks[m.espn_matchup_id] !== undefined).length;

  return (
    <div>
      <div className="pick-progress">
        <strong>{made} of {matchups.length}</strong> picked
        {made === matchups.length && <span className="tag best">All in</span>}
      </div>

      {err && <p className="pick-error" role="alert">{err}</p>}

      {matchups.map((m, index) => {
        const chosen = picks[m.espn_matchup_id];
        const side = (id: number, name: string, owners: string | null) => (
          <button
            key={id}
            type="button"
            className={`pick ${chosen === id ? 'on' : ''}`}
            disabled={locked || pending}
            aria-pressed={chosen === id}
            onClick={() => choose(m.espn_matchup_id, id)}
          >
            <span className="pick-team">{name}</span>
            {owners && <span className="pick-owner">{owners}</span>}
          </button>
        );
        return (
          <div className="matchup" key={m.espn_matchup_id}>
            <div className="matchup-head">
              <span>Matchup {index + 1} of {matchups.length}</span>
              {saved === m.espn_matchup_id && <span className="matchup-saved">Saved</span>}
              {chosen === undefined && <span className="matchup-todo">No pick yet</span>}
            </div>
            <div className="matchup-body">
              {side(m.away_team_id, m.away_name, m.away_owners)}
              <span className="matchup-vs" aria-hidden="true">vs</span>
              {side(m.home_team_id, m.home_name, m.home_owners)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
