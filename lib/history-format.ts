export function record(wins: number, losses: number, ties = 0) {
  return `${wins}-${losses}${ties ? `-${ties}` : ''}`;
}

export function winRate(wins: number, losses: number, ties = 0) {
  const games = wins + losses + ties;
  return games ? (wins + ties / 2) / games : 0;
}

export function pointsPerGame(points: string | number | null, wins: number, losses: number, ties = 0) {
  const games = wins + losses + ties;
  if (!games || points === null) return null;
  return Number(points) / games;
}

export function finish(place: number | null) {
  if (place === null) return null;
  if (place === 1) return 'Champion';
  if (place === 2) return 'Runner-up';
  if (place <= 4) return 'Lost semifinal';
  if (place <= 6) return 'Lost first round';
  return `${place}th`;
}

export function ordinal(value: number) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

export function franchiseHref(key: string) {
  return `/franchise/${encodeURIComponent(key)}`;
}

export function managerHref(key: string) {
  return `/manager/${encodeURIComponent(key)}`;
}

export function seasonHref(season: number) {
  return `/history/${season}`;
}
