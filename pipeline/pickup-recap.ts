import type { RenderedRecap } from './recap.ts';

export type PickupQuery = <T>(text: string, params?: unknown[]) => Promise<T[]>;

export interface RecapPickup {
  player: string;
  position: string;
  team_name: string;
  points: string;
  projected: string | null;
  started: boolean;
  acquisition_type: string;
  bid_amount: string | null;
}

const POSITION_CASE = `case p.default_position_id
        when 1 then 'QB' when 2 then 'RB' when 3 then 'WR'
        when 4 then 'TE' when 5 then 'K' when 16 then 'D/ST' else 'other' end`;

/**
 * Successful waiver/free-agent additions from the recap week who immediately
 * produced more than ten fantasy points.
 *
 * ESPN stores ADD/DROP details inside transactions.raw.items. We only accept
 * executed transactions and explicit ADD items, so a failed waiver claim,
 * lineup shuffle or traded player cannot accidentally become a "pickup."
 */
export async function loadNotablePickups(
  query: PickupQuery,
  season: number,
  week: number
): Promise<RecapPickup[]> {
  return query<RecapPickup>(
    `with adds as (
       select distinct on (
                t.season, t.week, (item ->> 'toTeamId')::int,
                (item ->> 'playerId')::bigint
              )
              t.season, t.week,
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
        order by t.season, t.week,
                 (item ->> 'toTeamId')::int,
                 (item ->> 'playerId')::bigint,
                 t.proposed_at desc nulls last
     )
     select coalesce(p.full_name, 'Unknown player') as player,
            ${POSITION_CASE} as position,
            tm.name as team_name,
            round(r.applied_points, 1)::text as points,
            case when r.projected_points is null then null
                 else round(r.projected_points, 1)::text end as projected,
            r.is_starter as started,
            a.acquisition_type,
            case when coalesce(a.bid_amount, 0) > 0
                 then round(a.bid_amount, 2)::text else null end as bid_amount
       from adds a
       join public.roster_entries r
         on r.season = a.season and r.week = a.week
        and r.espn_team_id = a.espn_team_id
        and r.espn_player_id = a.espn_player_id
       join public.players p on p.espn_player_id = a.espn_player_id
       join public.teams tm
         on tm.season = a.season and tm.espn_team_id = a.espn_team_id
      where r.applied_points > 10
      order by r.applied_points desc, p.full_name`,
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

function details(row: RecapPickup): string[] {
  const parts = [`${row.points} pts`];
  if (row.projected !== null) parts.push(`${row.projected} projected`);
  parts.push(row.started ? 'started' : 'bench');
  if (row.bid_amount !== null) parts.push(`$${row.bid_amount} FAAB`);
  return parts;
}

/**
 * Add the optional pickup block to the already-rendered weekly letter.
 * Keeping this as a post-render extension means the core recap remains usable
 * for the website and tests while transaction-specific email content stays
 * coupled to the email delivery path that owns it.
 */
export function addPickupHighlights(
  rendered: RenderedRecap,
  pickups: RecapPickup[]
): RenderedRecap {
  if (pickups.length === 0) return rendered;

  const html = `
    <div style="margin:32px 0 10px">
      <div style="height:3px;width:34px;background:#0f766e;border-radius:2px"></div>
      <div style="color:#0f766e;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;margin-top:9px">Waiver wire</div>
      <h2 style="font-size:19px;margin:2px 0 0;letter-spacing:-.02em">Pickups that paid off</h2>
      <p style="color:#6b7280;font-size:13px;margin:5px 0 10px">Added this scoring week and scored more than 10 fantasy points.</p>
    </div>
    ${pickups.map((row) => `
      <div style="border:1px solid #d1fae5;background:#f0fdfa;border-radius:10px;padding:13px 15px;margin-bottom:10px">
        <div><strong>${escapeHtml(row.player)}</strong> <span style="color:#0f766e;font-size:12px;font-weight:700">${escapeHtml(row.position)}</span></div>
        <div style="color:#4b5563;font-size:13px;margin-top:4px;line-height:1.55">
          Added by <strong>${escapeHtml(row.team_name)}</strong> through ${escapeHtml(method(row))}.<br>
          <strong style="color:#0f766e">${escapeHtml(row.points)} pts</strong>${row.projected !== null ? ` vs ${escapeHtml(row.projected)} projected` : ''}
          &middot; ${row.started ? 'Started' : 'Bench'}${row.bid_amount !== null ? ` &middot; $${escapeHtml(row.bid_amount)} FAAB` : ''}
        </div>
      </div>`).join('')}`;

  const footerMarker = '<p style="margin:32px 0 8px;text-align:center"><a href=';
  const htmlBody = rendered.html.includes(footerMarker)
    ? rendered.html.replace(footerMarker, `${html}${footerMarker}`)
    : `${rendered.html}${html}`;

  const pickupText = pickups.map((row) =>
    `${row.player} (${row.position}) — ${row.team_name} via ${method(row)}; ` +
    `${details(row).join(' · ')}`
  ).join('\n');
  const textBlock = `NOTABLE PICKUPS\n${pickupText}`;
  const textMarker = '\n\nFull site:';
  const textBody = rendered.text.includes(textMarker)
    ? rendered.text.replace(textMarker, `\n\n${textBlock}${textMarker}`)
    : `${rendered.text}\n\n${textBlock}`;

  return { ...rendered, html: htmlBody, text: textBody };
}
