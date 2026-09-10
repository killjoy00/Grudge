import { getAdminOperationalStatus, type WorkflowStatus } from '../../../lib/admin-status.ts';

export const dynamic = 'force-dynamic';

function shortSha(value: string | null) {
  return value ? value.slice(0, 8) : 'unavailable';
}

function when(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function runLabel(workflow: WorkflowStatus) {
  const run = workflow.latest;
  if (!run) return 'Unavailable';
  if (run.status !== 'completed') return run.status;
  return run.conclusion ?? 'completed';
}

function StatusCard({label, value, detail}: {label: string; value: React.ReactNode; detail: React.ReactNode}) {
  return (
    <div className="card" style={{margin: 0}}>
      <div className="section-kicker">{label}</div>
      <div style={{fontSize: '1.15rem', fontWeight: 800, marginTop: 4}}>{value}</div>
      <div className="note" style={{marginTop: 6}}>{detail}</div>
    </div>
  );
}

export default async function AdminStatusPage() {
  const status = await getAdminOperationalStatus();
  const db = status.database;
  const releaseAligned = Boolean(status.productionSha && status.mainSha && status.productionSha === status.mainSha);

  return (
    <>
      <h1>System status</h1>
      <p className="sub">One-screen production health for the Grudge data, models, automation and release.</p>

      <div className="card">
        <div className="section-kicker">Overall</div>
        <h2 style={{marginBottom: 6}}>{status.warnings.length === 0 ? 'Healthy' : 'Needs attention'}</h2>
        {status.warnings.length === 0 ? (
          <p className="note">No stale-data, schema, workflow or release warnings detected.</p>
        ) : (
          <ul className="plain">
            {status.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}
        <p className="note">Checked {when(status.checkedAt)}. GitHub status is read from the public repository API; no GitHub or Vercel credential is exposed to the web app.</p>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18}}>
        <StatusCard
          label="Release"
          value={releaseAligned ? 'Production = main' : 'Check release'}
          detail={<><code>{shortSha(status.productionSha)}</code> live · <code>{shortSha(status.mainSha)}</code> main · <code>{shortSha(status.deployedMarkerSha)}</code> verified marker</>}
        />
        <StatusCard
          label="Schema"
          value={status.schemaOk ? 'Contract satisfied' : 'Contract mismatch'}
          detail={<><code>{status.schemaVersion}</code>{status.schemaMissing.length ? ` · missing ${status.schemaMissing.join(', ')}` : ''}</>}
        />
        <StatusCard
          label="ESPN league data"
          value={db ? `${db.current_season}${db.latest_completed_team_week ? ` · completed week ${db.latest_completed_team_week}` : ' · no completed week'}` : 'Unavailable'}
          detail={db ? <>Season snapshot {when(db.season_updated_at)} · ownership {db.ownership_week ? `week ${db.ownership_week}, ` : ''}{when(db.latest_ownership_capture)}</> : 'Database status query returned no row.'}
        />
        <StatusCard
          label="NFL player ledger"
          value={db?.latest_player_season ? `${db.latest_player_season}${db.latest_player_week ? ` · week ${db.latest_player_week}` : ''}` : 'Awaiting games'}
          detail={<>Last refresh workflow: {when(status.workflows.players.lastSuccess?.updated_at)}</>}
        />
        <StatusCard
          label="Published models"
          value={db?.latest_draft_model_version ? `Draft ${db.latest_draft_model_version}` : 'Unavailable'}
          detail={db ? <>Draft {when(db.latest_draft_model_at)} · trade {db.latest_trade_model_version ?? '—'} {when(db.latest_trade_model_at)}</> : 'Database status query returned no row.'}
        />
        <StatusCard
          label="Weekly recap"
          value={db?.latest_recap_week ? `${db.current_season} · week ${db.latest_recap_week}` : 'None sent this season'}
          detail={db?.latest_recap_at ? when(db.latest_recap_at) : 'Expected only after a completed week and a recap-enabled weekly run.'}
        />
      </div>

      <div className="card">
        <h2>Automation</h2>
        <p className="note">Latest GitHub Actions state. Tap a run to open its logs.</p>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Job</th><th>Latest</th><th>Last success</th><th>Commit</th></tr>
            </thead>
            <tbody>
              {([
                ['Weekly pipeline', status.workflows.weekly],
                ['Player refresh', status.workflows.players],
                ['Model refresh', status.workflows.models],
                ['Controlled deploy', status.workflows.deploy],
                ['CI', status.workflows.ci],
              ] as [string, WorkflowStatus][]).map(([label, workflow]) => (
                <tr key={label}>
                  <td>{workflow.latest?.html_url ? <a href={workflow.latest.html_url} target="_blank" rel="noopener noreferrer">{label}</a> : label}</td>
                  <td>{runLabel(workflow)}</td>
                  <td className="tsub">{when(workflow.lastSuccess?.updated_at)}</td>
                  <td><code>{shortSha(workflow.latest?.head_sha ?? null)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
