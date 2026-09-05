import type { RenderedRecap } from './recap.ts';

export type PickupQuery = <T>(text: string, params?: unknown[]) => Promise<T[]>;

export interface RecapPickup {
  player: string;
  position: string;
  team_name: string;
  points: string | null;
  projected: string | null;
  started: boolean | null;
  acquisition_type: string;
  bid_amount: string | null;
}

const POSITION_CASE = `case p.default_position_id
        when 1 then 'QB' when 2 then 'RB' when 3 then 'WR'
        when 4 then 'TE' when 5 then 'K' when 16 then 'D/ST' else 'other' end`;

/**
 * Load every successful waiver/free-agent ADD from the recap scoring week.
 *
 * Do not filter by fantasy output here. The email has two distinct jobs:
 *   1. show every successful WAIVER add and its FAAB cost; and
 *   2. separately highlight any WAIVER or FREEAGENT add that scored >10.
 *
 * The roster join is deliberately LEFT JOINed. A waiver pickup still belongs
 * in the transaction report even if the player was dropped again before the
 * weekly roster snapshot or otherwise has no score row.
 */
export async function loadRecapPickups(
  query: PickupQuery,
  season: number,
  week: number
): Promise<RecapPickup[]> {
  return query<RecapPickup>(
    `with adds as (
       select t.season, t.week,
              (item ->> 'toTeamId')::int as espn_team_id,
              (item ->> 'playerId')::bigint as espn_player_id,
              t.type as acquisition_type,
              t.bid_amount,
              t.proposed_at
         from public.transactions t
         cross join lateral jsonb_array_elements(
           coalesce(t.raw -> 'items', '[]'::jsonb)
         ) item
        where t.season = $1 and t.week = $2
          and t.status = 'EXECUTED'
          and t.type in ('WAIVER', 'FREEAGENT')
          and item ->> 'type' = 'ADD'
          and coalesce((item ->> 'toTeamId')::int, 0) > 0
     )
     select coalesce(p.full_name, 'Unknown player') as player,
            ${POSITION_CASE} as position,
            coalesce(tm.name, 'Team ' || a.espn_team_id::text) as team_name,
            case when r.applied_points is null then null
                 else round(r.applied_points, 1)::text end as points,
            case when r.projected_points is null then null
                 else round(r.projected_points, 1)::text end as projected,
            r.is_starter as started,
            a.acquisition_type,
            case when a.acquisition_type = 'WAIVER'
                 then round(coalesce(a.bid_amount, 0), 2)::text
                 when coalesce(a.bid_amount, 0) > 0
                 then round(a.bid_amount, 2)::text
                 else null end as bid_amount
       from adds a
       left join public.roster_entries r
         on r.season = a.season and r.week = a.week
        and r.espn_team_id = a.espn_team_id
        and r.espn_player_id = a.espn_player_id
       left join public.players p on p.espn_player_id = a.espn_player_id
       left join public.teams tm
         on tm.season = a.season and tm.espn_team_id = a.espn_team_id
      order by a.proposed_at asc nulls last, player`,
    [season, week]
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function method(row: RecapPickup): string {
  return row.acquisition_type === 'WAIVER' ? 'waivers' : 'free agency';
}

function faab(row: RecapPickup): string | null {
  if (row.acquisition_type !== 'WAIVER' && row.bid_amount === null) return null;
  const value = Number(row.bid_amount ?? 0);
  return `$${Number.isFinite(value) ? value.toFixed(2) : row.bid_amount ?? '0.00'} FAAB`;
}

function scoringDetails(row: RecapPickup): string[] {
  if (row.points === null) return ['no score recorded'];
  const parts = [`${row.points} pts`];
  if (row.projected !== null) parts.push(`${row.projected} projected`);
  if (row.started !== null) parts.push(row.started ? 'started' : 'bench');
  return parts;
}

function waiverHtml(row: RecapPickup): string {
  const spend = faab(row) ?? '$0.00 FAAB';
  const score = scoringDetails(row).join(' &middot; ');
  return `
    <div style="border-bottom:1px solid #e5e7eb;padding:10px 2px">
      <div><strong>${escapeHtml(row.player)}</strong> <span style="color:#6b7280;font-size:12px;font-weight:700">${escapeHtml(row.position)}</span></div>
      <div style="color:#4b5563;font-size:13px;margin-top:3px;line-height:1.5">
        ${escapeHtml(row.team_name)} &middot; <strong>${escapeHtml(spend)}</strong> &middot; ${score}
      </div>
    </div>`;
}

function impactHtml(row: RecapPickup): string {
  const spend = faab(row);
  return `
    <div style="border:1px solid #d1fae5;background:#f0fdfa;border-radius:10px;padding:13px 15px;margin-bottom:10px">
      <div><strong>${escapeHtml(row.player)}</strong> <span style="color:#0f766e;font-size:12px;font-weight:700">${escapeHtml(row.position)}</span></div>
      <div style="color:#4b5563;font-size:13px;margin-top:4px;line-height:1.55">
        Added by <strong>${escapeHtml(row.team_name)}</strong> through ${escapeHtml(method(row))}.<br>
        <strong style="color:#0f766e">${escapeHtml(row.points)} pts</strong>${row.projected !== null ? ` vs ${escapeHtml(row.projected)} projected` : ''}` +
        `${row.started !== null ? ` &middot; ${row.started ? 'Started' : 'Bench'}` : ''}` +
        `${spend ? ` &middot; ${escapeHtml(spend)}` : ''}
      </div>
    </div>`;
}

/**
 * Add transaction coverage to the weekly email.
 *
 * The first block is comprehensive for WAIVER adds, including $0 claims. The
 * second is intentionally selective and can include both waiver and free-agent
 * pickups, so an immediately useful free-agent add is not lost just because no
 * FAAB was required.
 */
export function addPickupReport(
  rendered: RenderedRecap,
  pickups: RecapPickup[]
): RenderedRecap {
  const waivers = pickups.filter((row) => row.acquisition_type === 'WAIVER');
  const impact = pickups
    .filter((row) => row.points !== null && Number(row.points) > 10)
    .sort((a, b) => Number(b.points) - Number(a.points));

  if (waivers.length === 0 && impact.length === 0) return rendered;

  const waiverBlock = waivers.length ? `
    <h3 style="font-size:15px;margin:14px 0 4px">All waiver pickups</h3>
    <p style="color:#6b7280;font-size:13px;margin:0 0 6px">Every successful waiver add this scoring week, including FAAB spent.</p>
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:2px 13px 3px;margin-bottom:16px">
      ${waivers.map(waiverHtml).join('')}
    </div>` : '';

  const impactBlock = impact.length ? `
    <h3 style="font-size:15px;margin:18px 0 4px">10+ point pickups</h3>
    <p style="color:#6b7280;font-size:13px;margin:0 0 9px">Any waiver or free-agent add that scored more than 10 fantasy points this week.</p>
    ${impact.map(impactHtml).join('')}` : '';

  const html = `
    <div style="margin:32px 0 10px">
      <div style="height:3px;width:34px;background:#0f766e;border-radius:2px"></div>
      <div style="color:#0f766e;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;margin-top:9px">Transactions</div>
      <h2 style="font-size:19px;margin:2px 0 0;letter-spacing:-.02em">Waivers &amp; free agents</h2>
    </div>
    ${waiverBlock}${impactBlock}`;

  const footerMarker = '<p style="margin:32px 0 8px;text-align:center"><a href=';
  const htmlBody = rendered.html.includes(footerMarker)
    ? rendered.html.replace(footerMarker, `${html}${footerMarker}`)
    : `${rendered.html}${html}`;

  const waiverText = waivers.map((row) => {
    const spend = faab(row) ?? '$0.00 FAAB';
    return `${row.player} (${row.position}) — ${row.team_name}; ${spend}; ${scoringDetails(row).join(' · ')}`;
  }).join('\n');
  const impactText = impact.map((row) => {
    const spend = faab(row);
    return `${row.player} (${row.position}) — ${row.team_name} via ${method(row)}; ` +
      `${scoringDetails(row).join(' · ')}${spend ? ` · ${spend}` : ''}`;
  }).join('\n');

  const textSections = [
    waiverText && `WAIVER PICKUPS\n${waiverText}`,
    impactText && `10+ POINT PICKUPS\n${impactText}`,
  ].filter(Boolean).join('\n\n');
  const textMarker = '\n\nFull site:';
  const textBody = rendered.text.includes(textMarker)
    ? rendered.text.replace(textMarker, `\n\n${textSections}${textMarker}`)
    : `${rendered.text}\n\n${textSections}`;

  return { ...rendered, html: htmlBody, text: textBody };
}
