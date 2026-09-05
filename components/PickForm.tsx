'use client';
import { useState, useTransition } from 'react';
import { submitPick } from '../lib/actions.ts';
import { EspnMatchupLink } from './EspnLink.tsx';

export interface Matchup {
  espn_matchup_id: number;
  home_team_id: number; home_name: string; home_owners: string | null;
  away_team_id: number; away_name: string; away_owners: string | null;
}

/** One team's best players, for the "who are these guys again" reminder. */
export interface Star {
  espn_player_id: number;
  full_name: string | null;
  position: string;
  detail: string;
}

export interface Projection {
  /** ESPN's projected starting-lineup total for each side. */
  home: number; away: number;
  /** When the snapshot was taken -- the page says "as of", so it must know. */
  capturedAt: string;
}

/**
 * What ESPN thinks, stated as of the day it was captured.
 *
 * ESPN publishes no win probability, so "projects X to win" means its
 * projected starting-lineup totals put X ahead -- which is the same comparison
 * ESPN's own matchup page invites you to make. The day is named because the
 * snapshot is taken once a week and ESPN keeps revising afterwards; without it
 * the line would read as current and be wrong by Sunday.
 *
 * A dead-even projection is not a coin flip credited to ESPN. It says so.
 */
function ProjectionLine({ matchup, projection }: { matchup: Matchup; projection: Projection }) {
  const { home, away, capturedAt } = projection;
  const day = new Date(capturedAt).toLocaleDateString(undefined, {
    weekday: 'long', timeZone: 'America/New_York',
  });
  const favourite = home === away ? null : home > away ? matchup.home_name : matchup.away_name;
  return (
    <p className="matchup-projection">
      As of {day}, ESPN{' '}
      {favourite === null
        ? <>has these two dead even at {home.toFixed(1)}.</>
        : <>projects <strong>{favourite}</strong> to win,{' '}
           {Math.max(home, away).toFixed(1)} to {Math.min(home, away).toFixed(1)}.</>}
    </p>
  );
}

/**
 * One card per matchup, two sides and a VS between them, so the week reads as
 * five head-to-head games rather than a list of ten team names.
 */
export function PickForm({
  season, week, matchups, initial, locked, projections = {}, stars = {},
}: {
  season: number; week: number; matchups: Matchup[];
  initial: Record<number, number>; locked: boolean;
  /** By matchup id. Absent until the Tuesday capture has run for this week. */
  projections?: Record<number, Projection>;
  /** By team id. Empty in a week with nothing to draw on. */
  stars?: Record<number, Star[]>;
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
        const proj = projections[m.espn_matchup_id];
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
            {/* The stars sit INSIDE the button, under the name, because they
                are the reason you are about to tap it. Marked presentational
                so a screen reader announces the team, not a roster. */}
            {(stars[id] ?? []).length > 0 && (
              <span className="pick-stars" aria-hidden="true">
                {(stars[id] ?? []).map((s) => (
                  <span key={s.espn_player_id} className="pick-star">
                    <span className="pick-star-pos">{s.position}</span>
                    {s.full_name ?? 'Unknown'}
                  </span>
                ))}
              </span>
            )}
          </button>
        );
        return (
          <div className="matchup" key={m.espn_matchup_id}>
            <div className="matchup-head">
              <span>Matchup {index + 1} of {matchups.length}</span>
              {saved === m.espn_matchup_id && <span className="matchup-saved">Saved</span>}
              {chosen === undefined && <span className="matchup-todo">No pick yet</span>}
              {/* Not inside the pick buttons: those are the control, and a link
                  within one would both fight the click and be invalid HTML. */}
              <a
                href={`/matchup/${season}/${week}/${m.espn_matchup_id}`}
                className="espn-link"
              >
                Preview
              </a>
              <EspnMatchupLink season={season} week={week} teamId={m.away_team_id} />
            </div>
            <div className="matchup-body">
              {side(m.away_team_id, m.away_name, m.away_owners)}
              <span className="matchup-vs" aria-hidden="true">vs</span>
              {side(m.home_team_id, m.home_name, m.home_owners)}
            </div>
            {proj && <ProjectionLine matchup={m} projection={proj} />}
          </div>
        );
      })}
    </div>
  );
}
