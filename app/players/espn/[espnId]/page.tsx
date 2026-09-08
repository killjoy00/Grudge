import { redirect, notFound } from 'next/navigation';
import { asPublic } from '../../../../lib/db.ts';
import { playerFilters, playerHref } from '../../../../lib/player-data.ts';

export const dynamic = 'force-dynamic';
export default async function ResolvePlayer({params, searchParams}: {
  params: Promise<{espnId: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const {espnId} = await params;
  if (!/^-?\d{1,12}$/.test(espnId)) notFound();
  const {season} = playerFilters(await searchParams);
  const [alias] = await asPublic<{player_key: string}>(
    'select player_key from public.nfl_player_aliases where season=$1 and espn_player_id=$2', [season, espnId]);
  if (alias) redirect(playerHref(alias.player_key, season));
  return <div className="card empty-state"><strong>Player identity is still being matched</strong>
    <span>The {season} archive has ESPN player {espnId}, but no confident NFL identity link yet.</span><a href={`/players?season=${season}`}>Browse {season} players</a></div>;
}
