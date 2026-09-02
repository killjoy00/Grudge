/**
 * The ESPN URL formats, pinned.
 *
 * A wrong query parameter here fails silently: the link still opens, ESPN just
 * shows the wrong team, the wrong week, or a generic page. Nothing in the build
 * or the type system catches that, so the exact strings are asserted against
 * URLs known to work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ESPN_LEAGUE_ID, espnMatchupUrl, espnTeamUrl } from './espn-links.ts';

test('the team link matches a URL known to work', () => {
  assert.equal(
    espnTeamUrl(2, 2026),
    'https://fantasy.espn.com/football/team?leagueId=114052&seasonId=2026&teamId=2'
  );
});

test('the matchup link matches a URL known to work', () => {
  // ESPN calls the week matchupPeriodId; it is the same number this site calls
  // `week`, because both count matchup periods rather than NFL scoring periods.
  assert.equal(
    espnMatchupUrl(2026, 1, 4),
    'https://fantasy.espn.com/football/fantasycast?leagueId=114052' +
      '&matchupPeriodId=1&seasonId=2026&teamId=4'
  );
});

test('the league id is the one in every members bookmark', () => {
  assert.equal(ESPN_LEAGUE_ID, 114052);
});

test('season and week are carried through, not hardcoded', () => {
  // The obvious way to break these is to bake in the current season.
  assert.match(espnTeamUrl(9, 2019), /seasonId=2019/);
  assert.match(espnTeamUrl(9, 2019), /teamId=9/);
  assert.match(espnMatchupUrl(2024, 14, 11), /seasonId=2024/);
  assert.match(espnMatchupUrl(2024, 14, 11), /matchupPeriodId=14/);
  assert.match(espnMatchupUrl(2024, 14, 11), /teamId=11/);
});
