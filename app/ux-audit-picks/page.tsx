import { PickForm } from '../../components/PickForm.tsx';

export const dynamic = 'force-dynamic';

const matchups = [
  { espn_matchup_id: 1, away_team_id: 1, away_name: 'The Penthouse Panda Bear', away_owners: 'Jordan', home_team_id: 2, home_name: 'Your Worst Nightmares', home_owners: 'Alex' },
  { espn_matchup_id: 2, away_team_id: 3, away_name: 'Raleigh Silly Nannies', away_owners: 'Taylor', home_team_id: 4, home_name: 'P RIVERS NAS NAS', home_owners: 'Chris' },
  { espn_matchup_id: 3, away_team_id: 5, away_name: 'Brightleaf Yuppies', away_owners: 'Sam', home_team_id: 6, home_name: 'The Penguins', home_owners: 'Jamie' },
  { espn_matchup_id: 4, away_team_id: 7, away_name: 'Taco MacArthur', away_owners: 'Pat', home_team_id: 8, home_name: 'CTE Deniers', home_owners: 'Morgan' },
  { espn_matchup_id: 5, away_team_id: 9, away_name: 'Run and Hide', away_owners: 'Casey', home_team_id: 10, home_name: 'Austin Bubbs', home_owners: 'Drew' },
];

const stars = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, [
  { espn_player_id: (i + 1) * 10 + 1, full_name: 'Amon-Ra St. Brown', position: 'WR', detail: 'starter' },
  { espn_player_id: (i + 1) * 10 + 2, full_name: 'Christian McCaffrey', position: 'RB', detail: 'starter' },
]]));

const projections = Object.fromEntries(matchups.map((m, i) => [m.espn_matchup_id, {
  away: 118.4 + i,
  home: 121.7 + i,
  capturedAt: '2026-09-08T15:00:00Z',
}]));

export default function AuditPicksPage() {
  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Call your shot</div>
        <h1>Predictions</h1>
        <p>Week 1 · Picks lock Saturday at midnight ET — the whole of Saturday is yours.</p>
      </div>
      <div className="card">
        <p className="note" style={{ marginBottom: 12 }}>
          Locked audit fixture. The controls are intentionally disabled so this route cannot write data.
        </p>
        <PickForm
          season={2026}
          week={1}
          matchups={matchups}
          initial={{ 1: 2, 3: 5 }}
          locked={true}
          projections={projections}
          stars={stars}
        />
      </div>
    </>
  );
}
