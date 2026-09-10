#!/usr/bin/env node

const LEAGUE_ID = 114052;
const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;
if (!SWID || !ESPN_S2) throw new Error('ESPN credentials are required');

const transactionTypes = [
  'DRAFT', 'FREEAGENT', 'WAIVER', 'WAIVER_ERROR', 'ROSTER', 'RETRO_ROSTER', 'FUTURE_ROSTER',
  'TRADE_ACCEPT', 'TRADE_PROPOSAL', 'TRADE_UPHOLD', 'TRADE_DECLINE', 'TRADE_VETO', 'TRADE_ERROR',
];
const filter = JSON.stringify({ transactions: { filterType: { value: transactionTypes } } });
const headers = {
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}`,
  'x-fantasy-filter': filter,
};

function unwrap(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

async function fetchPeriod(season, period) {
  const url = `${BASE}/leagueHistory/${LEAGUE_ID}?seasonId=${season}&view=mTransactions2&scoringPeriodId=${period}`;
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) return { status: response.status, transactions: [], error: text.slice(0, 500) };
  const data = unwrap(JSON.parse(text));
  return { status: response.status, transactions: data?.transactions ?? [] };
}

function summarizeTransaction(transaction) {
  return {
    id: transaction.id ?? null,
    type: transaction.type ?? null,
    status: transaction.status ?? null,
    executionType: transaction.executionType ?? null,
    processDate: transaction.processDate ?? null,
    proposedDate: transaction.proposedDate ?? null,
    scoringPeriodId: transaction.scoringPeriodId ?? null,
    teamId: transaction.teamId ?? null,
    relatedTransactionId: transaction.relatedTransactionId ?? null,
    bidAmount: transaction.bidAmount ?? null,
    items: (transaction.items ?? []).map((item) => ({
      playerId: item.playerId ?? null,
      fromTeamId: item.fromTeamId ?? null,
      toTeamId: item.toTeamId ?? null,
      type: item.type ?? null,
      lineupSlotId: item.lineupSlotId ?? null,
    })),
  };
}

const output = { generatedAt: new Date().toISOString(), filter: JSON.parse(filter), seasons: {} };
for (const season of [2005, 2006]) {
  const byId = new Map();
  const periods = [];
  for (let period = 0; period <= 18; period += 1) {
    const result = await fetchPeriod(season, period);
    periods.push({ period, status: result.status, count: result.transactions.length, error: result.error ?? null });
    for (const transaction of result.transactions) {
      const key = String(transaction.id ?? `${period}:${JSON.stringify(transaction)}`);
      if (!byId.has(key)) byId.set(key, summarizeTransaction(transaction));
    }
  }
  const transactions = [...byId.values()];
  output.seasons[season] = { periods, transactions };
  const types = transactions.reduce((acc, t) => {
    const key = t.type ?? 'UNKNOWN';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`SEASON ${season}: unique transactions=${transactions.length}; types=${JSON.stringify(types)}`);
  for (const row of periods.filter((row) => row.count || row.status !== 200)) {
    console.log(`  period ${row.period}: status=${row.status} returned=${row.count}${row.error ? ` error=${row.error}` : ''}`);
  }
  for (const transaction of transactions.slice(0, 40)) {
    console.log(`  tx ${transaction.id} type=${transaction.type} status=${transaction.status} team=${transaction.teamId} period=${transaction.scoringPeriodId} items=${transaction.items.map((i) => `${i.type}:${i.playerId}:${i.fromTeamId}->${i.toTeamId}`).join(',')}`);
  }
}

const { writeFileSync } = await import('node:fs');
writeFileSync('legacy-transaction-probe.json', JSON.stringify(output, null, 2));
