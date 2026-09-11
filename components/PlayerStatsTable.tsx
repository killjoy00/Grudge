import { displayNumber, dominantScoreEvidence, playerHref, playerFilterHref, scoreEvidenceLabel, PLAYER_STATS, SCORE_EVIDENCE_CAPTION, statColumns, type PlayerRow, type PlayerFilters } from '../lib/player-data.ts';

export function PlayerStatsTable({ players, filters }: {players: PlayerRow[]; filters: PlayerFilters}) {
  const columns = statColumns(filters.position);
  const dominant = dominantScoreEvidence(players);
  const heading = (key: string, label: string) => <a href={playerFilterHref(filters, {
    sort: key, direction: filters.sort === key && filters.direction === 'desc' ? 'asc' : 'desc', page: 1,
  })}>{label}{filters.sort === key ? (filters.direction === 'desc' ? ' ↓' : ' ↑') : ''}</a>;
  return <><div className="scroll player-table" role="region" aria-label="Player statistics" tabIndex={0}>
    <table><thead><tr>
      <th className="player-name-cell">Player</th>
      <th className="num" aria-sort={filters.sort === 'points' ? (filters.direction === 'desc' ? 'descending' : 'ascending') : undefined}>{heading('points', 'Points')}</th>
      <th className="num">{heading('average', 'Avg')}</th><th className="num" title="Games with an NFL stat record in this range">Games*</th>
      {columns.map(key => <th className="num" key={key}>{heading(key, PLAYER_STATS.find(([k]) => k === key)![1])}</th>)}
    </tr></thead><tbody>{players.map(p => <tr key={p.player_key}>
      <td className="player-name-cell"><a href={`${playerHref(p.player_key, filters.season)}&period=${filters.period}&from=${filters.from}&to=${filters.to}`} className="tname">{p.full_name}</a>
        <span className="tsub block">{p.position} · {p.teams.join(' / ') || 'NFL team unavailable'}</span></td>
      <td className="num player-points"><strong>{displayNumber(p.points, 2)}</strong>
        {scoreEvidenceLabel(p) !== dominant &&
          <span className="tsub block">{scoreEvidenceLabel(p)}</span>}</td>
      <td className="num">{displayNumber(p.average, 2)}</td><td className="num">{p.games || '—'}</td>
      {columns.map(key => <td className="num" key={key}>{displayNumber(p[key], 0)}</td>)}
    </tr>)}</tbody></table>
  </div>
  {dominant && <p className="note evidence-note">{SCORE_EVIDENCE_CAPTION[dominant]}</p>}
  </>;
}
