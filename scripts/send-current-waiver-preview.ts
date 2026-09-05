import { connect } from '../pipeline/db.ts';
import { addPickupReport, loadRecapPickups, type PickupQuery } from '../pipeline/pickup-recap.ts';
import type { RenderedRecap } from '../pipeline/recap.ts';

const sql = connect() as unknown as { query: PickupQuery };
const query: PickupQuery = (text, params = []) => sql.query(text, params);

const recipient = 'ryanmindell@gmail.com';
const apiKey = process.env.RESEND_API_KEY?.trim();
const from = process.env.RECAP_FROM_EMAIL?.trim();
if (!apiKey || !from) throw new Error('RESEND_API_KEY and RECAP_FROM_EMAIL are required.');

const pickups = await loadRecapPickups(query, 2026, 1);
if (!pickups.length) throw new Error('No 2026 Week 1 pickups found.');

// One preseason waiver player has not reached the shared player table yet
// because no Week 1 boxscore exists. Use the ESPN id-resolved name only in
// this one-shot preview; the real Week 1 recap runs after boxscores are loaded.
const previewPickups = pickups.map((row) =>
  row.player === 'Unknown player' && row.team_name === 'Austin Bubbs' && Number(row.bid_amount) === 1
    ? { ...row, player: 'Mike Washington Jr.', position: 'RB' }
    : row
);

const base: RenderedRecap = {
  subject: '[TEST] Grudge Match — 2026 Week 1 waiver section preview',
  html: `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827">
      <div style="padding:24px 0 4px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#0f766e">Preview only</div>
        <h1 style="font-size:24px;margin:5px 0 8px">2026 Week 1 transaction section</h1>
        <p style="color:#4b5563;line-height:1.55">This uses the successful waiver claims already in the production database. Week 1 has not been played, so there are no scoring highlights yet.</p>
      </div>
    </div>`,
  text: 'PREVIEW ONLY\n2026 Week 1 transaction section\n\nThis uses the successful waiver claims already in production. Week 1 has not been played, so there are no scoring highlights yet.',
};

const rendered = addPickupReport(base, previewPickups);
const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': `grudge-waiver-preview-${Date.now()}`,
  },
  body: JSON.stringify({
    from,
    to: [recipient],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: [
      { name: 'kind', value: 'waiver-preview' },
      { name: 'season', value: '2026' },
      { name: 'week', value: '1' },
    ],
  }),
});
const payload = await response.json().catch(() => ({})) as { id?: string; name?: string };
if (!response.ok || !payload.id) throw new Error(`Resend failed: ${response.status} ${payload.name ?? 'unknown'}`);
console.log(`waiver preview sent (${payload.id}); pickups=${previewPickups.length}`);
