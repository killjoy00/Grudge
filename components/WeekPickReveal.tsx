export interface RevealedPick {
  user_id: string;
  display_name: string | null;
  espn_matchup_id: number;
  predicted_winner_team_id: number;
}

export interface PickRevealMatchup {
  espn_matchup_id: number;
  away_team_id: number;
  away_name: string;
  home_team_id: number;
  home_name: string;
}

export function WeekPickReveal({
  matchups,
  picks,
}: {
  matchups: PickRevealMatchup[];
  picks: RevealedPick[];
}) {
  return (
    <div className="card pick-reveal">
      {matchups.map((matchup) => {
        const game = picks.filter((pick) => pick.espn_matchup_id === matchup.espn_matchup_id);
        const away = game.filter((pick) => pick.predicted_winner_team_id === matchup.away_team_id);
        const home = game.filter((pick) => pick.predicted_winner_team_id === matchup.home_team_id);
        const label = (rows: RevealedPick[]) =>
          rows.length ? rows.map((row) => row.display_name ?? 'Someone').join(', ') : 'Nobody';

        return (
          <div className="pick-reveal-game" key={matchup.espn_matchup_id}>
            <div className="pick-reveal-matchup">
              <strong>{matchup.away_name}</strong>
              <span>at</span>
              <strong>{matchup.home_name}</strong>
            </div>
            <div className="pick-reveal-sides">
              <div>
                <span className="pick-reveal-team">{matchup.away_name} · {away.length}</span>
                <span className="pick-reveal-names">{label(away)}</span>
              </div>
              <div>
                <span className="pick-reveal-team">{matchup.home_name} · {home.length}</span>
                <span className="pick-reveal-names">{label(home)}</span>
              </div>
            </div>
          </div>
        );
      })}
      {picks.length === 0 && (
        <p className="note" style={{ margin: 0 }}>No picks were submitted for this week.</p>
      )}
    </div>
  );
}
