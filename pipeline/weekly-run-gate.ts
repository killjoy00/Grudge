#!/usr/bin/env -S npx tsx
/**
 * Decide whether a Weekly pipeline invocation should do the expensive work.
 *
 * Manual/current-season retry pushes are always honored. GitHub schedules and
 * the independent Tuesday-morning marker trigger are idempotent backstops: once
 * the latest started regular-season week is settled and every eligible recap
 * recipient has an accepted send record, later triggers become cheap no-ops.
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { connect } from './db.ts';

type Query = <T>(text: string, params?: unknown[]) => Promise<T[]>;

export interface WeeklyGateState {
  season: number;
  week: number | null;
  resultsComplete: boolean;
  eligible: number;
  sent: number;
}

export interface WeeklyGateDecision {
  shouldRun: boolean;
  reason: string;
}

export function assessWeeklyRunGate(
  triggerMode: string,
  state: WeeklyGateState
): WeeklyGateDecision {
  const backstop = triggerMode === 'schedule' || triggerMode === 'morning';
  if (!backstop) {
    return { shouldRun: true, reason: `${triggerMode || 'unknown'} trigger is explicit` };
  }
  if (state.week === null) {
    return { shouldRun: true, reason: 'no regular-season week has started yet' };
  }
  if (!state.resultsComplete) {
    return { shouldRun: true, reason: `week ${state.week} is not settled` };
  }
  if (state.eligible < 1) {
    return { shouldRun: true, reason: 'no eligible recap recipients were found' };
  }
  if (state.sent < state.eligible) {
    return {
      shouldRun: true,
      reason: `week ${state.week} recap accepted for ${state.sent}/${state.eligible} recipients`,
    };
  }
  return {
    shouldRun: false,
    reason: `week ${state.week} is settled and recap is accepted for ${state.sent}/${state.eligible}`,
  };
}

function asInt(value: number | string | null | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name} returned by the database.`);
  }
  return parsed;
}

function queryClient(): Query {
  const sql = connect() as unknown as { query: Query };
  return (text, params = []) => sql.query(text, params);
}

async function loadState(query: Query): Promise<WeeklyGateState> {
  const rows = await query<{
    season: number | string;
    week: number | string | null;
    results_complete: boolean | null;
    eligible: number | string;
    sent: number | string;
  }>(
    `with current_season as (
       select season, regular_season_weeks
         from public.seasons
        where is_current
        order by season desc
        limit 1
     ), current_week as (
       select w.week, w.results_complete
         from public.weeks w
         join current_season s on s.season = w.season
        where w.week <= s.regular_season_weeks
          and w.first_kickoff_at is not null
          and w.first_kickoff_at <= now()
        order by w.week desc
        limit 1
     ), eligible as (
       select p.email
         from public.profiles p
         join public.league_allowlist a on a.email = p.email
        where p.is_active and a.is_active and p.recap_email_enabled
     )
     select s.season::int as season,
            w.week::int as week,
            coalesce(w.results_complete, false) as results_complete,
            (select count(*)::int from eligible) as eligible,
            (select count(*)::int
               from public.recap_deliveries d
               join eligible e on e.email = d.recipient_email
              where d.season = s.season
                and d.week = w.week
                and d.status = 'sent') as sent
       from current_season s
       left join current_week w on true`
  );
  const row = rows[0];
  if (!row) throw new Error('No current season is configured.');

  return {
    season: asInt(row.season, 'season'),
    week: row.week === null ? null : asInt(row.week, 'week'),
    resultsComplete: Boolean(row.results_complete),
    eligible: asInt(row.eligible, 'eligible recipients'),
    sent: asInt(row.sent, 'sent deliveries'),
  };
}

function writeOutputs(state: WeeklyGateState, decision: WeeklyGateDecision) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  appendFileSync(
    output,
    [
      `should_run=${decision.shouldRun}`,
      `season=${state.season}`,
      `week=${state.week ?? ''}`,
      `eligible=${state.eligible}`,
      `sent=${state.sent}`,
      `reason=${decision.reason.replace(/[\r\n]+/g, ' ')}`,
      '',
    ].join('\n')
  );
}

async function main() {
  const triggerMode =
    process.env.TRIGGER_MODE?.trim() || process.env.EVENT_NAME?.trim() || 'unknown';
  const state = await loadState(queryClient());
  const decision = assessWeeklyRunGate(triggerMode, state);
  writeOutputs(state, decision);
  console.log(
    `${state.season} week ${state.week ?? 'not-started'}: weekly run gate = ` +
      `${decision.shouldRun ? 'RUN' : 'SKIP'} (${decision.reason}).`
  );
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\nweekly run gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
