#!/usr/bin/env -S npx tsx
/**
 * Verify that the current regular-season recap is safe to send and, optionally,
 * that every eligible league member has a successful delivery record.
 *
 * This is deliberately separate from send-recap.ts. The sender owns delivery
 * and idempotency; this checker owns the operational invariant that Tuesday must
 * never silently finish with a stale week or an incomplete recipient set.
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { connect } from './db.ts';

type Query = <T>(text: string, params?: unknown[]) => Promise<T[]>;

interface WeekRow {
  week: number | string;
  results_complete: boolean;
}

interface IntegrityRow {
  team_count: number | string;
  result_teams: number | string;
  total_matchups: number | string;
  final_matchups: number | string;
}

interface DeliveryRow {
  eligible: number | string;
  sent: number | string;
  failed: number | string;
  sending: number | string;
}

export interface RecapDeliveryState {
  season: number;
  week: number;
  resultsComplete: boolean;
  teamCount: number;
  resultTeams: number;
  totalMatchups: number;
  finalMatchups: number;
  eligible: number;
  sent: number;
  failed: number;
  sending: number;
}

export interface RecapDeliveryAssessment extends RecapDeliveryState {
  missing: number;
  complete: boolean;
}

function positiveInt(value: string | undefined, name: string, max: number): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}.`);
  }
  return parsed;
}

function asInt(value: number | string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name} returned by the database.`);
  }
  return parsed;
}

export function assessRecapDelivery(state: RecapDeliveryState): RecapDeliveryAssessment {
  if (!state.resultsComplete) {
    throw new Error(
      `${state.season} week ${state.week} is not results_complete; refusing to send an older recap.`
    );
  }
  if (state.resultTeams !== state.teamCount) {
    throw new Error(
      `${state.season} week ${state.week} has ${state.resultTeams}/${state.teamCount} team results; ` +
      'refusing to send a partial recap.'
    );
  }
  if (state.totalMatchups < 1 || state.finalMatchups !== state.totalMatchups) {
    throw new Error(
      `${state.season} week ${state.week} has ${state.finalMatchups}/${state.totalMatchups} final matchups; ` +
      'refusing to send a partial recap.'
    );
  }
  if (state.eligible < 1) {
    throw new Error('No active league members are eligible for recap email.');
  }

  const missing = Math.max(0, state.eligible - state.sent);
  return { ...state, missing, complete: missing === 0 };
}

function queryClient(): Query {
  const sql = connect() as unknown as { query: Query };
  return (text, params = []) => sql.query(text, params);
}

async function loadState(query: Query, requestedSeason: number | null, requestedWeek: number | null) {
  let season = requestedSeason;
  if (season === null) {
    const seasons = await query<{ season: number | string }>(
      `select season::int as season
         from public.seasons
        where is_current
        order by season desc
        limit 1`
    );
    if (!seasons[0]) throw new Error('No current season is configured.');
    season = asInt(seasons[0].season, 'season');
  }

  let weekRow: WeekRow | undefined;
  if (requestedWeek !== null) {
    const rows = await query<WeekRow>(
      `select week::int as week, results_complete
         from public.weeks
        where season = $1 and week = $2`,
      [season, requestedWeek]
    );
    weekRow = rows[0];
  } else {
    const rows = await query<WeekRow>(
      `select w.week::int as week, w.results_complete
         from public.weeks w
         join public.seasons s on s.season = w.season
        where w.season = $1
          and w.week <= s.regular_season_weeks
          and w.first_kickoff_at is not null
          and w.first_kickoff_at <= now()
        order by w.week desc
        limit 1`,
      [season]
    );
    weekRow = rows[0];
  }

  if (!weekRow) {
    throw new Error(
      requestedWeek === null
        ? `${season}: no regular-season week has started yet.`
        : `${season} week ${requestedWeek} does not exist.`
    );
  }
  const week = asInt(weekRow.week, 'week');

  const integrityRows = await query<IntegrityRow>(
    `select s.team_count::int as team_count,
            (select count(*)::int
               from public.team_week_results r
              where r.season = s.season and r.week = $2
                and r.points_for is not null) as result_teams,
            (select count(*)::int
               from public.matchups m
              where m.season = s.season and m.week = $2) as total_matchups,
            (select count(*)::int
               from public.matchups m
              where m.season = s.season and m.week = $2 and m.is_final) as final_matchups
       from public.seasons s
      where s.season = $1`,
    [season, week]
  );
  if (!integrityRows[0]) throw new Error(`${season}: season settings are missing.`);

  const deliveryRows = await query<DeliveryRow>(
    `with eligible as (
       select p.id, p.email
         from public.profiles p
         join public.league_allowlist a on a.email = p.email
        where p.is_active and a.is_active and p.recap_email_enabled
     )
     select count(*)::int as eligible,
            (count(*) filter (where d.status = 'sent'))::int as sent,
            (count(*) filter (where d.status = 'failed'))::int as failed,
            (count(*) filter (where d.status = 'sending'))::int as sending
       from eligible e
       left join public.recap_deliveries d
         on d.season = $1 and d.week = $2 and d.recipient_email = e.email`,
    [season, week]
  );
  if (!deliveryRows[0]) throw new Error('Could not read recap delivery state.');

  return assessRecapDelivery({
    season,
    week,
    resultsComplete: Boolean(weekRow.results_complete),
    teamCount: asInt(integrityRows[0].team_count, 'team_count'),
    resultTeams: asInt(integrityRows[0].result_teams, 'result_teams'),
    totalMatchups: asInt(integrityRows[0].total_matchups, 'total_matchups'),
    finalMatchups: asInt(integrityRows[0].final_matchups, 'final_matchups'),
    eligible: asInt(deliveryRows[0].eligible, 'eligible recipients'),
    sent: asInt(deliveryRows[0].sent, 'sent deliveries'),
    failed: asInt(deliveryRows[0].failed, 'failed deliveries'),
    sending: asInt(deliveryRows[0].sending, 'sending deliveries'),
  });
}

function writeGithubOutputs(state: RecapDeliveryAssessment) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  appendFileSync(
    output,
    [
      `season=${state.season}`,
      `week=${state.week}`,
      `eligible=${state.eligible}`,
      `sent=${state.sent}`,
      `missing=${state.missing}`,
      `failed=${state.failed}`,
      `sending=${state.sending}`,
      `complete=${state.complete}`,
      '',
    ].join('\n')
  );
}

async function main() {
  const args = process.argv.slice(2);
  const requireComplete = args.includes('--require-complete');
  const season = positiveInt(
    args.find((arg) => arg.startsWith('--season='))?.split('=')[1],
    '--season',
    2100
  );
  if (season !== null && season < 2018) throw new Error('--season must be 2018 or later.');
  const week = positiveInt(
    args.find((arg) => arg.startsWith('--week='))?.split('=')[1],
    '--week',
    18
  );

  const state = await loadState(queryClient(), season, week);
  writeGithubOutputs(state);

  console.log(
    `${state.season} week ${state.week}: ${state.sent}/${state.eligible} recap deliveries sent; ` +
    `${state.missing} missing, ${state.failed} failed, ${state.sending} still sending.`
  );

  if (requireComplete && !state.complete) {
    throw new Error(
      `${state.season} week ${state.week} recap delivery is incomplete: ` +
      `${state.sent}/${state.eligible} sent.`
    );
  }
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\nrecap delivery check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
