import { espnMatchupUrl, espnTeamUrl } from '../lib/espn-links.ts';

/**
 * A small outbound marker to ESPN.
 *
 * Kept visually quiet on purpose: the team name itself stays an internal link
 * to the franchise file, which is what this site is for. This sits beside it
 * for the one thing ESPN has and we do not -- the live roster, or the live
 * scoreboard.
 *
 * No 'use client' directive, so it can be rendered from server components and
 * from the pick form alike.
 */
export function EspnTeamLink({
  teamId, season, label = 'ESPN',
}: { teamId: number; season: number; label?: string }) {
  return (
    <a
      className="espn-link"
      href={espnTeamUrl(teamId, season)}
      target="_blank"
      rel="noopener noreferrer"
      title="Open this team's roster on ESPN"
    >
      {label}<span aria-hidden="true"> ↗</span>
    </a>
  );
}

export function EspnMatchupLink({
  season, week, teamId, label = 'Live on ESPN',
}: { season: number; week: number; teamId: number; label?: string }) {
  return (
    <a
      className="espn-link"
      href={espnMatchupUrl(season, week, teamId)}
      target="_blank"
      rel="noopener noreferrer"
      title="Open this matchup on ESPN"
    >
      {label}<span aria-hidden="true"> ↗</span>
    </a>
  );
}
