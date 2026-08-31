#!/usr/bin/env -S npx tsx
/** Send the latest completed week's recap to each configured league member. */

import { createHash } from 'node:crypto';

import { connect } from './db.ts';
import {
  parseRecipients,
  renderWeeklyRecap,
  type RecapAward,
  type RecapBenchRow,
  type RecapGame,
  type RecapPredictionRow,
  type RecapStanding,
  type WeeklyRecap,
} from './recap.ts';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_IF_EMPTY = args.includes('--skip-if-empty');
const seasonArg = args.find((arg) => arg.startsWith('--season='))?.split('=')[1];
const weekArg = args.find((arg) => arg.startsWith('--week='))?.split('=')[1];
const SEASON = Number(seasonArg ?? new Date().getUTCFullYear());

if (!Number.isInteger(SEASON) || SEASON < 2018 || SEASON > 2100) {
  throw new Error('--season must be a four-digit year.');
}

function optionalPositiveInt(value: string | undefined, name: string): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 18) {
    throw new Error(`${name} must be an integer from 1 to 18.`);
  }
  return parsed;
}

const REQUESTED_WEEK = optionalPositiveInt(weekArg, '--week');

type Query = <T>(text: string, params?: unknown[]) => Promise<T[]>;

function queryClient(): Query {
  const sql = connect() as unknown as { query: Query };
  return (text, params = []) => sql.query(text, params);
}

async function loadRecap(query: Query): Promise<WeeklyRecap | null> {
  const weekRows = REQUESTED_WEEK === null
    ? await query<{ week: number }>(
        `select max(week)::int as week
           from public.team_week_results
          where season = $1`,
        [SEASON]
      )
    : [{ week: REQUESTED_WEEK }];
  const week = Number(weekRows[0]?.week);
  if (!Number.isInteger(week) || week < 1) {
    if (SKIP_IF_EMPTY) return null;
    throw new Error(`${SEASON} has no completed week to recap.`);
  }

  const [games, awards, bench, standings, predictions] = await Promise.all([
    query<RecapGame>(
      `select at.name as away_name, round(m.away_points, 1)::text as away_points,
              ht.name as home_name, round(m.home_points, 1)::text as home_points, m.winner
         from public.matchups m
         join public.teams at on at.season = m.season and at.espn_team_id = m.away_team_id
         join public.teams ht on ht.season = m.season and ht.espn_team_id = m.home_team_id
        where m.season = $1 and m.week = $2 and m.is_final
        order by m.espn_matchup_id`, [SEASON, week]),
    query<RecapAward>(
      `select a.award_key, t.name, round(a.value, 1)::text as value
         from public.weekly_awards a
         left join public.teams t on t.season = a.season and t.espn_team_id = a.espn_team_id
        where a.season = $1 and a.week = $2
        order by array_position(array['high_scorer','low_scorer','blowout','nailbiter','worst_bench'], a.award_key)`,
      [SEASON, week]),
    query<RecapBenchRow>(
      `select t.name, round(r.points_for, 1)::text as points_for,
              round(r.optimal_points, 1)::text as optimal_points,
              round(r.points_left_on_bench, 1)::text as points_left_on_bench
         from public.team_week_results r
         join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
        where r.season = $1 and r.week = $2
        order by r.points_left_on_bench desc nulls last`, [SEASON, week]),
    query<RecapStanding>(
      `select t.name, r.cum_wins as wins, r.cum_losses as losses, r.cum_ties as ties,
              round(r.cum_points_for, 1)::text as points_for
         from public.team_week_results r
         join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
        where r.season = $1 and r.week = $2
        order by r.cum_wins desc, r.cum_points_for desc`, [SEASON, week]),
    query<RecapPredictionRow>(
      `select pr.display_name,
              count(*) filter (where s.is_correct)::int as correct,
              coalesce(sum(s.points), 0)::text as points,
              round(count(*) filter (where s.is_correct)::numeric
                    / nullif(count(s.prediction_id), 0), 4)::text as accuracy
         from public.predictions p
         join public.profiles pr on pr.id = p.user_id
         left join public.prediction_scores s on s.prediction_id = p.id
        where p.season = $1
        group by p.user_id, pr.display_name
        order by coalesce(sum(s.points), 0) desc,
                 count(*) filter (where s.is_correct) desc
        limit 3`, [SEASON]),
  ]);

  if (games.length === 0) throw new Error(`${SEASON} week ${week} has no final matchups.`);
  return { season: SEASON, week, games, awards, bench, standings, predictions };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to send weekly recaps.`);
  return value;
}

async function sendOne(
  apiKey: string,
  from: string,
  recipient: string,
  recap: WeeklyRecap,
  rendered: ReturnType<typeof renderWeeklyRecap>
): Promise<string> {
  const recipientHash = createHash('sha256').update(recipient).digest('hex').slice(0, 16);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `grudge-recap-${recap.season}-${recap.week}-${recipientHash}`,
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [
        { name: 'kind', value: 'weekly-recap' },
        { name: 'season', value: String(recap.season) },
        { name: 'week', value: String(recap.week) },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; name?: string };
  if (!response.ok || !payload.id) {
    // Do not print the API's free-form message: validation errors may echo the
    // recipient, and the address list is intentionally a repository secret.
    throw new Error(`Resend returned HTTP ${response.status} (${payload.name ?? 'unknown error'})`);
  }
  return payload.id;
}

async function main() {
  const recap = await loadRecap(queryClient());
  if (!recap) {
    console.log(`${SEASON}: no completed week yet; no recap sent.`);
    return;
  }
  const siteUrl = process.env.RECAP_SITE_URL?.trim() || 'https://grudge.planitnow.us';
  const rendered = renderWeeklyRecap(recap, siteUrl);

  if (DRY_RUN) {
    console.log(rendered.subject);
    console.log(rendered.text);
    console.log('\nDry run: no email sent.');
    return;
  }

  const apiKey = required('RESEND_API_KEY');
  const from = required('RECAP_FROM_EMAIL');
  const recipients = parseRecipients(required('RECAP_RECIPIENTS'));
  if (recipients.length === 0) throw new Error('RECAP_RECIPIENTS has no email addresses.');

  console.log(`${recap.season} week ${recap.week}: sending ${recipients.length} private recap email(s)`);
  const failures: string[] = [];
  for (let i = 0; i < recipients.length; i++) {
    try {
      const id = await sendOne(apiKey, from, recipients[i]!, recap, rendered);
      console.log(`  sent ${i + 1}/${recipients.length} (${id})`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      console.error(`  failed ${i + 1}/${recipients.length}`);
    }
  }
  if (failures.length) {
    throw new Error(`${failures.length} recap email(s) failed. First error: ${failures[0]}`);
  }
}

main().catch((error) => {
  console.error(`\nrecap email failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
