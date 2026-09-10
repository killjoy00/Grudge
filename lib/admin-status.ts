import 'server-only';

import { asUser } from './db.ts';
import {
  SCHEMA_CONTRACT_VERSION,
  SCHEMA_PROBE_SQL,
  missingSchemaRequirements,
  schemaProbeOk,
  type SchemaProbeRow,
} from './schema-contract.ts';

const REPO_API = 'https://api.github.com/repos/killjoy00/Grudge';
const WORKFLOWS = {
  weekly: '.github/workflows/weekly.yml',
  players: '.github/workflows/refresh-players.yml',
  models: '.github/workflows/refresh-model-results.yml',
  deploy: '.github/workflows/deploy-vercel.yml',
  ci: '.github/workflows/ci.yml',
} as const;

interface GitHubBranchResponse {
  commit?: { sha?: string };
}

interface GitHubRun {
  id: number;
  name: string;
  path: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  event: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface GitHubRunsResponse {
  workflow_runs?: GitHubRun[];
}

export interface WorkflowStatus {
  path: string;
  latest: GitHubRun | null;
  lastSuccess: GitHubRun | null;
}

export interface DatabaseStatus {
  current_season: number;
  season_updated_at: string | null;
  latest_completed_team_week: number | null;
  latest_final_matchup_week: number | null;
  ownership_week: number | null;
  latest_ownership_capture: string | null;
  latest_player_season: number | null;
  latest_player_week: number | null;
  latest_draft_model_version: string | null;
  latest_draft_model_at: string | null;
  latest_trade_model_version: string | null;
  latest_trade_model_at: string | null;
  latest_recap_week: number | null;
  latest_recap_at: string | null;
}

export interface AdminOperationalStatus {
  checkedAt: string;
  productionSha: string | null;
  mainSha: string | null;
  deployedMarkerSha: string | null;
  schemaVersion: string;
  schemaOk: boolean;
  schemaMissing: string[];
  database: DatabaseStatus | null;
  workflows: Record<keyof typeof WORKFLOWS, WorkflowStatus>;
  warnings: string[];
}

async function githubJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${REPO_API}${path}`, {
      cache: 'no-store',
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'grudge-admin-status',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function workflowStatus(path: string, runs: GitHubRun[]): WorkflowStatus {
  const matching = runs.filter((run) => run.path === path);
  return {
    path,
    latest: matching[0] ?? null,
    lastSuccess: matching.find((run) => run.conclusion === 'success') ?? null,
  };
}

function hoursOld(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now - timestamp) / 3_600_000);
}

export function operationalWarnings(input: {
  productionSha: string | null;
  mainSha: string | null;
  deployedMarkerSha: string | null;
  schemaOk: boolean;
  database: DatabaseStatus | null;
  workflows: Record<keyof typeof WORKFLOWS, WorkflowStatus>;
  now?: number;
}): string[] {
  const now = input.now ?? Date.now();
  const warnings: string[] = [];

  if (!input.schemaOk) warnings.push('Production database does not satisfy the current schema contract.');
  if (!input.mainSha) warnings.push('GitHub branch status is unavailable.');
  if (!input.productionSha) warnings.push('Production commit SHA is unavailable in this runtime.');
  if (input.mainSha && input.productionSha && input.mainSha !== input.productionSha) {
    warnings.push('Production is behind main.');
  }
  if (input.productionSha && input.deployedMarkerSha && input.productionSha !== input.deployedMarkerSha) {
    warnings.push('The verified deployment marker does not match the commit this page is serving.');
  }

  const weekly = input.workflows.weekly;
  if (weekly.latest?.conclusion && weekly.latest.conclusion !== 'success') {
    warnings.push('The latest weekly pipeline run did not succeed.');
  }
  const weeklyAge = hoursOld(weekly.lastSuccess?.updated_at, now);
  if (weeklyAge !== null && weeklyAge > 8 * 24) warnings.push('No successful weekly pipeline run in more than 8 days.');
  if (!weekly.lastSuccess) warnings.push('No successful weekly pipeline run is visible from GitHub.');

  const players = input.workflows.players;
  if (players.latest?.conclusion && players.latest.conclusion !== 'success') {
    warnings.push('The latest NFL player refresh did not succeed.');
  }
  const playerAge = hoursOld(players.lastSuccess?.updated_at, now);
  if (playerAge !== null && playerAge > 36) warnings.push('NFL player data has not refreshed successfully in more than 36 hours.');
  if (!players.lastSuccess) warnings.push('No successful NFL player refresh is visible from GitHub.');

  const seasonAge = hoursOld(input.database?.season_updated_at, now);
  if (seasonAge !== null && seasonAge > 8 * 24) warnings.push('The current ESPN season snapshot is more than 8 days old.');
  const ownershipAge = hoursOld(input.database?.latest_ownership_capture, now);
  if (ownershipAge !== null && ownershipAge > 8 * 24) warnings.push('Free-agent ownership capture is more than 8 days old.');

  return warnings;
}

async function getDatabaseStatus(): Promise<{schema: SchemaProbeRow | null; status: DatabaseStatus | null}> {
  const [schemaRows] = await asUser<SchemaProbeRow>((q) => [q(SCHEMA_PROBE_SQL)]);
  const [statusRows] = await asUser<DatabaseStatus>((q) => [q(`
    with current as (
      select season, updated_at
        from public.seasons
       order by season desc
       limit 1
    ), latest_player as (
      select season, max(week)::int as week
        from public.nfl_player_games
       where season_type = 'REG'
       group by season
       order by season desc
       limit 1
    )
    select c.season::int as current_season,
           c.updated_at::text as season_updated_at,
           (select max(week)::int from public.team_week_results where season = c.season) as latest_completed_team_week,
           (select max(week)::int from public.matchups where season = c.season and is_final) as latest_final_matchup_week,
           (select max(week)::int from public.player_ownership_snapshots where season = c.season) as ownership_week,
           (select max(captured_at)::text from public.player_ownership_snapshots where season = c.season) as latest_ownership_capture,
           lp.season::int as latest_player_season,
           lp.week::int as latest_player_week,
           (select model_version from public.model_runs where model_kind = 'draft' order by created_at desc limit 1) as latest_draft_model_version,
           (select created_at::text from public.model_runs where model_kind = 'draft' order by created_at desc limit 1) as latest_draft_model_at,
           (select model_version from public.model_runs where model_kind = 'trade' order by created_at desc limit 1) as latest_trade_model_version,
           (select created_at::text from public.model_runs where model_kind = 'trade' order by created_at desc limit 1) as latest_trade_model_at,
           (select max(week)::int from public.recap_deliveries where season = c.season and status = 'sent') as latest_recap_week,
           (select max(sent_at)::text from public.recap_deliveries where season = c.season and status = 'sent') as latest_recap_at
      from current c
      left join latest_player lp on true
  `)]);
  return { schema: schemaRows?.[0] ?? null, status: statusRows?.[0] ?? null };
}

export async function getAdminOperationalStatus(): Promise<AdminOperationalStatus> {
  const [databaseResult, main, marker, runsResponse] = await Promise.all([
    getDatabaseStatus(),
    githubJson<GitHubBranchResponse>('/branches/main'),
    githubJson<GitHubBranchResponse>('/branches/vercel-deployed'),
    githubJson<GitHubRunsResponse>('/actions/runs?per_page=100'),
  ]);
  const runs = runsResponse?.workflow_runs ?? [];
  const workflows = {
    weekly: workflowStatus(WORKFLOWS.weekly, runs),
    players: workflowStatus(WORKFLOWS.players, runs),
    models: workflowStatus(WORKFLOWS.models, runs),
    deploy: workflowStatus(WORKFLOWS.deploy, runs),
    ci: workflowStatus(WORKFLOWS.ci, runs),
  };
  const schema = databaseResult.schema;
  const schemaOk = schemaProbeOk(schema);
  const productionSha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null;
  const mainSha = main?.commit?.sha ?? null;
  const deployedMarkerSha = marker?.commit?.sha ?? null;

  return {
    checkedAt: new Date().toISOString(),
    productionSha,
    mainSha,
    deployedMarkerSha,
    schemaVersion: SCHEMA_CONTRACT_VERSION,
    schemaOk,
    schemaMissing: schemaOk ? [] : missingSchemaRequirements(schema),
    database: databaseResult.status,
    workflows,
    warnings: operationalWarnings({
      productionSha,
      mainSha,
      deployedMarkerSha,
      schemaOk,
      database: databaseResult.status,
      workflows,
    }),
  };
}
