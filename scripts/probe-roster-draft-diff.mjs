#!/usr/bin/env node

const LEAGUE_ID = 114052;
const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;
if (!SWID || !ESPN_S2) throw new Error('ESPN credentials are required');
const headers = { accept: 'application/json', cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` };

function unwrap(value) { return Array.isArray(value) && value.length === 1 ? value[0] : value; }

for (const season of [2005, 2006]) {
  const url = `${BASE}/leagueHistory/${LEAGUE_ID}?seasonId=${season}&view=mDraftDetail&view=mRoster&view=mTeam`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${season}: HTTP ${response.status}`);
  const data = unwrap(await response.json());
  const picks = data.draftDetail?.picks ?? [];
  console.log(`SEASON ${season}`);
  for (const team of (data.teams ?? []).sort((a,b) => a.id-b.id)) {
    const known = picks.filter((p) => p.teamId === team.id && p.playerId !== 0).map((p) => p.playerId);
    const zero = picks.filter((p) => p.teamId === team.id && p.playerId === 0);
    const roster = (team.roster?.entries ?? []).map((entry) => ({
      id: entry.playerPoolEntry?.player?.id ?? null,
      name: entry.playerPoolEntry?.player?.fullName ?? null,
      pos: entry.playerPoolEntry?.player?.defaultPositionId ?? null,
      slot: entry.lineupSlotId ?? null,
    }));
    const rosterIds = new Set(roster.map((r) => r.id).filter((id) => id !== null));
    const knownSet = new Set(known);
    const notOnRoster = known.filter((id) => !rosterIds.has(id));
    const notKnownDraft = roster.filter((r) => r.id !== null && !knownSet.has(r.id));
    console.log(` team=${team.id} name=${team.name ?? team.location ?? ''} knownDraft=${known.length} zero=${zero.length} roster=${roster.length} knownNotRoster=${notOnRoster.length} rosterNotKnown=${notKnownDraft.length}`);
    if (zero.length) console.log(`   zeroSlots=${zero.map((p)=>`${p.overallPickNumber}:slot${p.lineupSlotId}`).join(',')}`);
    if (notKnownDraft.length) console.log(`   candidates=${notKnownDraft.map((r)=>`${r.id}:${r.name}:pos${r.pos}:slot${r.slot}`).join(' | ')}`);
    if (notOnRoster.length) console.log(`   draftedGone=${notOnRoster.join(',')}`);
  }
}
