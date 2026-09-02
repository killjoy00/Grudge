import 'server-only';

/**
 * Trade-model inputs, read from the database.
 *
 * This file is SQL and nothing else. The assembly and the model live in
 * pipeline/trade-assemble.ts and pipeline/trade.ts, both importable by tests;
 * keeping logic out of here is what makes any of it verifiable, since a
 * `server-only` module cannot be loaded outside Next.
 *
 * The same functions run for the CLI (from the raw archives) and for the admin
 * page (from what the pipeline loaded out of them). Both must agree, because
 * they are the same code over the same numbers.
 *
 * None of this was possible until players.eligible_slots landed: slot
 * eligibility existed only in the raw payloads, which is why the trade finder
 * was a CLI and not a page.
 */
import {
  buildTradeReport, capacityFromStarters,
  type FillRow, type RosterRow, type ScoringRow, type TradeResult,
} from '../pipeline/trade-assemble.ts';
import { asPublic } from './db.ts';

export type { TradeReport, TradeResult } from '../pipeline/trade-assemble.ts';

/**
 * Run the trade finder for a season, or refuse and say why.
 *
 * `teamId` narrows the suggestions to one franchise without changing the
 * model -- replacement levels are league-wide by definition, so the filter
 * has to happen after the search, never before it.
 */
export async function tradeReport(
  season: number, teamId: number | null = null
): Promise<TradeResult> {
  const [weekRows, teams, scoring, fills, latest, starters] = await Promise.all([
    asPublic<{ weeks: number | null; through: number | null }>(
      `select count(distinct week)::int as weeks, max(week)::int as through
         from public.roster_entries where season = $1`,
      [season]
    ),
    asPublic<{ espn_team_id: number; name: string }>(
      `select espn_team_id, name from public.teams where season = $1`,
      [season]
    ),
    asPublic<ScoringRow>(
      `select r.espn_player_id, p.full_name, p.default_position_id, p.eligible_slots,
              sum(coalesce(r.applied_points, 0))::text as total,
              count(*)::int as games
         from public.roster_entries r
         join public.players p using (espn_player_id)
        where r.season = $1
        group by r.espn_player_id, p.full_name, p.default_position_id, p.eligible_slots`,
      [season]
    ),
    asPublic<FillRow>(
      `select r.lineup_slot_id, p.default_position_id, count(*)::int as n
         from public.roster_entries r
         join public.players p using (espn_player_id)
        where r.season = $1 and r.is_starter and p.default_position_id is not null
        group by 1, 2`,
      [season]
    ),
    // Rosters as they stand: the most recent week loaded.
    asPublic<RosterRow>(
      `select espn_team_id, espn_player_id
         from public.roster_entries
        where season = $1
          and week = (select max(week) from public.roster_entries where season = $1)`,
      [season]
    ),
    asPublic<{ week: number; espn_team_id: number; lineup_slot_id: number }>(
      `select week, espn_team_id, lineup_slot_id
         from public.roster_entries
        where season = $1 and is_starter`,
      [season]
    ),
  ]);

  return buildTradeReport({
    season,
    weeks: weekRows[0]?.weeks ?? 0,
    throughWeek: weekRows[0]?.through ?? 0,
    scoring, fills, latest,
    capacity: capacityFromStarters(starters),
    teams: new Map(teams.map((t) => [t.espn_team_id, t.name])),
    teamId,
  });
}
