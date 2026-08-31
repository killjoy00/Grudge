import { notFound } from 'next/navigation';

import { adminProfile } from '../../../lib/admin.ts';
import { getRecapDeliveries } from '../../../lib/admin-queries.ts';

export const dynamic = 'force-dynamic';

function when(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export default async function RecapHistoryPage() {
  if (!(await adminProfile())) notFound();
  const deliveries = await getRecapDeliveries(150);
  const sent = deliveries.filter((row) => row.status === 'sent').length;
  const failed = deliveries.filter((row) => row.status === 'failed').length;
  const pending = deliveries.filter((row) => row.status === 'sending').length;

  return (
    <>
      <div className="page-hero compact-hero">
        <div className="eyebrow">Commissioner tools</div>
        <h1>Recap delivery</h1>
        <p>Resend API outcomes for each private weekly email.</p>
      </div>

      <div className="stat-strip three">
        <div><strong>{sent}</strong><span>Accepted</span></div>
        <div><strong>{failed}</strong><span>Failed</span></div>
        <div><strong>{pending}</strong><span>In progress</span></div>
      </div>

      <div className="card">
        {deliveries.length === 0 ? (
          <div className="empty-state">
            <strong>No recap attempts yet</strong>
            <span>The first completed Tuesday run will appear here.</span>
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Member</th><th>Recap</th><th>Status</th>
                  <th className="num">Attempts</th><th>Last attempt</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="tname">{row.display_name || row.recipient_email}</span>
                      {row.display_name && <span className="tsub block">{row.recipient_email}</span>}
                    </td>
                    <td>{row.season} · W{row.week}</td>
                    <td>
                      <span className={`delivery-status ${row.status}`}>{row.status}</span>
                      {row.error_code && <span className="tsub block">{row.error_code}</span>}
                    </td>
                    <td className="num">{row.attempt_count}</td>
                    <td className="tsub">{when(row.last_attempted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">
          “Accepted” means Resend accepted the message for delivery. Bounces and
          inbox placement require a future Resend webhook integration.
        </p>
      </div>
    </>
  );
}
