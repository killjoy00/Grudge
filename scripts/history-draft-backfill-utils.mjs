export function mergeDraftDetail(league, draftDetail, season) {
  if (!league || typeof league !== 'object' || Array.isArray(league)) {
    throw new Error(`${season}: existing archive payload is not an object.`);
  }
  const picks = draftDetail?.picks;
  if (!Array.isArray(picks) || picks.length === 0) {
    throw new Error(`${season}: draft payload has no picks.`);
  }
  return {
    ...league,
    seasonId: league.seasonId ?? season,
    draftDetail,
  };
}

export function mergeDraftManifest(manifest, draftPicks, capturedAt) {
  return {
    ...(manifest ?? {}),
    availability: {
      ...(manifest?.availability ?? {}),
      draftBoard: true,
      draftPicks,
    },
    draftBackfilledAt: capturedAt,
  };
}
