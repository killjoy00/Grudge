/**
 * Reconstructs playoff records for the 2005-2017 archive.
 *
 * The recovered spreadsheets give final standings plus a finish order, not a
 * bracket: place 1 won the title, 2 lost the final, 3-4 lost the semifinals,
 * 5-6 lost the first round. That is enough to recover each team's playoff
 * record only once you commit to a bracket shape, so this module states the
 * shape explicitly and refuses to guess when the finish order cannot be
 * produced by it.
 *
 * The shape (ESPN's default six-team bracket, and the one the finish orders
 * actually fit): seeds 1-2 get a bye, seeds 3-6 play the first round as 3v6
 * and 4v5, the semifinals are 1 vs the 4/5 winner and 2 vs the 3/6 winner.
 * Seeding is win percentage then points for -- except where a season names its
 * bye teams, which is how a divisional season is expressed here.
 */

export interface BracketTeam {
  franchise_key: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number | null;
  final_place: number;
}

export interface PlayoffRecord {
  franchise_key: string;
  seed: number;
  playoff_wins: number;
  playoff_losses: number;
}

export const PLAYOFF_FIELD = 6;

function standingOrder(a: BracketTeam, b: BracketTeam) {
  const rate = (team: BracketTeam) => {
    const games = team.wins + team.losses + team.ties;
    return games ? (team.wins + team.ties / 2) / games : 0;
  };
  return rate(b) - rate(a) || (b.points_for ?? 0) - (a.points_for ?? 0);
}

/**
 * Seeds the playoff field. `byes` names the two teams that skip the first
 * round when regular-season standing alone does not decide it; leaving it
 * empty seeds the whole field by standing.
 */
export function seedField(teams: BracketTeam[], byes: string[] = []): BracketTeam[] {
  const qualifiers = teams.filter((team) => team.final_place <= PLAYOFF_FIELD);
  if (qualifiers.length !== PLAYOFF_FIELD) {
    throw new Error(`Expected ${PLAYOFF_FIELD} playoff finishes, found ${qualifiers.length}.`);
  }
  const byStanding = [...teams].sort(standingOrder);
  const bestSix = new Set(byStanding.slice(0, PLAYOFF_FIELD).map((team) => team.franchise_key));
  const intruder = qualifiers.find((team) => !bestSix.has(team.franchise_key));
  if (intruder) {
    throw new Error(
      `${intruder.franchise_key} finished in the playoff places without a top-${PLAYOFF_FIELD} record.`
    );
  }

  const field = qualifiers.sort(standingOrder);
  if (byes.length === 0) return field;
  if (byes.length !== 2) throw new Error('A season names either two bye teams or none.');

  const isBye = new Set(byes);
  const seeded = [
    ...field.filter((team) => isBye.has(team.franchise_key)),
    ...field.filter((team) => !isBye.has(team.franchise_key)),
  ];
  if (seeded.length !== PLAYOFF_FIELD || seeded.filter((t) => isBye.has(t.franchise_key)).length !== 2) {
    throw new Error(`Bye teams ${byes.join(', ')} are not both in the playoff field.`);
  }
  return seeded;
}

/**
 * Walks the bracket forward and checks that it lands on the recorded finish
 * order, then returns each qualifier's playoff record. Throws when no such
 * walk exists -- an unreconstructable season should stop an import, not
 * silently invent a record.
 */
export function derivePlayoffRecords(teams: BracketTeam[], byes: string[] = []): PlayoffRecord[] {
  const field = seedField(teams, byes);
  const seedOf = new Map(field.map((team, index) => [team.franchise_key, index + 1]));
  const placeOf = new Map(field.map((team) => [team.franchise_key, team.final_place]));
  const at = (seed: number) => field[seed - 1]!.franchise_key;

  const wins = new Map(field.map((team) => [team.franchise_key, 0]));
  const losses = new Map(field.map((team) => [team.franchise_key, 0]));

  /** Plays one game: the team whose finish is better advances. */
  const play = (home: string, away: string, expectedLoserPlaces: number[]) => {
    const homePlace = placeOf.get(home)!;
    const awayPlace = placeOf.get(away)!;
    const [winner, loser] = homePlace < awayPlace ? [home, away] : [away, home];
    if (!expectedLoserPlaces.includes(placeOf.get(loser)!)) {
      throw new Error(
        `${loser} finished ${placeOf.get(loser)} but the bracket has it losing in the round ` +
        `that finishes ${expectedLoserPlaces.join(' and ')}; the finish order does not fit the bracket.`
      );
    }
    wins.set(winner, wins.get(winner)! + 1);
    losses.set(loser, losses.get(loser)! + 1);
    return winner;
  };

  const lowerHalf = play(at(3), at(6), [5, 6]);
  const upperHalf = play(at(4), at(5), [5, 6]);
  const finalists = [play(at(1), upperHalf, [3, 4]), play(at(2), lowerHalf, [3, 4])];
  const champion = play(finalists[0]!, finalists[1]!, [2]);
  if (placeOf.get(champion) !== 1) {
    throw new Error(`${champion} won the bracket but is recorded as finishing ${placeOf.get(champion)}.`);
  }

  return field.map((team) => ({
    franchise_key: team.franchise_key,
    seed: seedOf.get(team.franchise_key)!,
    playoff_wins: wins.get(team.franchise_key)!,
    playoff_losses: losses.get(team.franchise_key)!,
  }));
}
