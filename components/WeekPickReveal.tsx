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
    <div className="card">
      {matchups.map((matchup, index) => {
        const game = picks.filter((pick) => pick.espn_matchup_id === matchup.espn_matchup_id);
        const away = game.filter((pick) => pick.predicted_winner_team_id === matchup.away_team_id);
        const home = game.filter((pick) => pick.predicted_winner_team_id === matchup.home_team_id);
        const label = (rows: RevealedPick[]) =>
          rows.length ? rows.map((row) => row.display_name ?? 'Someone').join(', ') : 'Nobody';

        return (
          <div
            key={matchup.espn_matchup_id}
            style={{
              padding: index === 0 ? '0 0 15px' : '15px 0',
              borderTop: index === 0 ? 0 : '1px solid var(--line)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline', marginBottom: 8 }}>
              <strong style={{ color: 'var(--navy)' }}>{matchup.away_name}</strong>
              <span className="note" style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>at</span>
              <strong style={{ color: 'var(--navy)' }}>{matchup.home_name}</strong>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              <div style={{ padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <strong style={{ display: 'block', fontSize: 12, color: 'var(--navy)' }}>
                  {matchup.away_name} · {away.length}
                </strong>
                <span className="note" style={{ display: 'block', margin: '3px 0 0', fontSize: 12 }}>{label(away)}</span>
              </div>
              <div style={{ padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <strong style={{ display: 'block', fontSize: 12, color: 'var(--navy)' }}>
                  {matchup.home_name} · {home.length}
                </strong>
                <span className="note" style={{ display: 'block', margin: '3px 0 0', fontSize: 12 }}>{label(home)}</span>
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
