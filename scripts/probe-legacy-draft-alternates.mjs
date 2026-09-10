#!/usr/bin/env node

const LEAGUE_ID = 114052;
const seasons = [2005, 2006];
const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;
if (!SWID || !ESPN_S2) throw new Error('ESPN credentials are required');

const headers = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}`,
};

function unwrap(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

async function fetchText(url) {
  const response = await fetch(url, { headers, redirect: 'follow' });
  return { status: response.status, url: response.url, text: await response.text() };
}

async function fetchJson(url) {
  const result = await fetchText(url);
  let data = null;
  try { data = unwrap(JSON.parse(result.text)); } catch {}
  return { ...result, data };
}

function pickSummary(pick) {
  return {
    id: pick.id ?? null,
    overallPickNumber: pick.overallPickNumber ?? null,
    roundId: pick.roundId ?? null,
    roundPickNumber: pick.roundPickNumber ?? null,
    teamId: pick.teamId ?? null,
    playerId: pick.playerId ?? null,
    lineupSlotId: pick.lineupSlotId ?? null,
    autoDraftTypeId: pick.autoDraftTypeId ?? null,
    nominatingTeamId: pick.nominatingTeamId ?? null,
    owningTeamIds: pick.owningTeamIds ?? null,
    memberId: pick.memberId ?? null,
    reservedForKeeper: Boolean(pick.reservedForKeeper),
    keeper: Boolean(pick.keeper),
    tradeLocked: Boolean(pick.tradeLocked),
    keys: Object.keys(pick).sort(),
  };
}

function rosterSummary(data) {
  return (data?.teams ?? []).map((team) => ({
    teamId: team.id,
    entries: (team.roster?.entries ?? []).map((entry) => {
      const player = entry.playerPoolEntry?.player;
      return {
        playerId: player?.id ?? null,
        fullName: player?.fullName ?? null,
        positionId: player?.defaultPositionId ?? null,
        acquisitionType: entry.acquisitionType ?? null,
        acquisitionDate: entry.acquisitionDate ?? null,
        lineupSlotId: entry.lineupSlotId ?? null,
        entryKeys: Object.keys(entry).sort(),
      };
    }),
  }));
}

const bases = [
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl',
  'https://fantasy.espn.com/apis/v3/games/ffl',
];

const output = { generatedAt: new Date().toISOString(), seasons: {} };

for (const season of seasons) {
  const seasonOut = { sources: [], rosterSnapshots: [], html: [] };
  output.seasons[season] = seasonOut;

  for (const base of bases) {
    const endpoints = [
      `${base}/leagueHistory/${LEAGUE_ID}?seasonId=${season}&view=mDraftDetail&view=mTeam&view=mRoster`,
      `${base}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}?view=mDraftDetail&view=mTeam&view=mRoster`,
    ];
    for (const url of endpoints) {
      const result = await fetchJson(url);
      const picks = result.data?.draftDetail?.picks ?? [];
      const zeros = picks.filter((p) => Number(p.playerId) === 0);
      seasonOut.sources.push({
        url: url.replace(base, new URL(base).host),
        status: result.status,
        finalHost: result.url ? new URL(result.url).host : null,
        pickCount: picks.length,
        zeroPlayerCount: zeros.length,
        zeroPicks: zeros.map(pickSummary),
        allPicks: picks.map(pickSummary),
      });
    }

    for (const scoringPeriodId of [0, 1, 2]) {
      const url = `${base}/leagueHistory/${LEAGUE_ID}?seasonId=${season}&view=mRoster&view=mTeam&scoringPeriodId=${scoringPeriodId}`;
      const result = await fetchJson(url);
      seasonOut.rosterSnapshots.push({
        host: new URL(base).host,
        scoringPeriodId,
        status: result.status,
        teams: rosterSummary(result.data),
      });
    }
  }

  for (const url of [
    `https://games.espn.com/ffl/tools/draftrecap?leagueId=${LEAGUE_ID}&seasonId=${season}`,
    `https://fantasy.espn.com/football/league/draftrecap?leagueId=${LEAGUE_ID}&seasonId=${season}`,
  ]) {
    const result = await fetchText(url);
    const plain = result.text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    seasonOut.html.push({
      requestedHost: new URL(url).host,
      status: result.status,
      finalUrl: result.url,
      bytes: result.text.length,
      containsDraftDetail: result.text.includes('draftDetail'),
      containsKnownPlayer: season === 2006 ? result.text.includes('Larry Johnson') : result.text.length > 0,
      textSample: plain.slice(0, 500),
    });
  }
}

await import('node:fs').then(({ writeFileSync }) => {
  writeFileSync('legacy-draft-probe.json', JSON.stringify(output, null, 2));
});

for (const [season, info] of Object.entries(output.seasons)) {
  console.log(`SEASON ${season}`);
  for (const source of info.sources) {
    console.log(`${source.url}: status=${source.status} picks=${source.pickCount} zeroPlayers=${source.zeroPlayerCount}`);
    console.log(` zero picks: ${source.zeroPicks.map((p) => p.overallPickNumber).join(',')}`);
    for (const pick of source.zeroPicks) {
      console.log(`  pick ${pick.overallPickNumber} r${pick.roundId} team=${pick.teamId} slot=${pick.lineupSlotId} auto=${pick.autoDraftTypeId} id=${pick.id} keeper=${pick.keeper} reserved=${pick.reservedForKeeper} owners=${JSON.stringify(pick.owningTeamIds)}`);
    }
  }
  for (const snapshot of info.rosterSnapshots) {
    const count = snapshot.teams.reduce((sum, team) => sum + team.entries.length, 0);
    const drafted = snapshot.teams.reduce((sum, team) => sum + team.entries.filter((entry) => entry.acquisitionType === 'DRAFT').length, 0);
    console.log(`${snapshot.host} roster sp=${snapshot.scoringPeriodId}: status=${snapshot.status} entries=${count} acquisitionType=DRAFT=${drafted}`);
  }
  for (const html of info.html) {
    console.log(`${html.requestedHost} html: status=${html.status} bytes=${html.bytes} final=${html.finalUrl} knownPlayer=${html.containsKnownPlayer}`);
  }
}
