'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  repairMembershipSync,
  saveMembership,
  type AdminActionResult,
  type MembershipInput,
} from '../lib/admin-actions.ts';
import type { ClerkMemberState } from '../lib/clerk-member-state.ts';

export interface MembershipTeam {
  id: number;
  name: string;
}

export interface MembershipRow {
  email: string;
  season: number;
  espnTeamId: number | null;
  isAdmin: boolean;
  isActive: boolean;
  clerkState: ClerkMemberState;
  profileId: string | null;
  displayName: string | null;
  recapEnabled: boolean | null;
}

function Result({ result }: { result: AdminActionResult | null }) {
  if (!result) return null;
  return result.ok
    ? <p className="ok compact" role="status">{result.message}</p>
    : <p className="err compact" role="alert">{result.error}</p>;
}

function MemberEditor({ row, teams }: { row: MembershipRow; teams: MembershipTeam[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [teamId, setTeamId] = useState(row.espnTeamId?.toString() ?? '');
  const [isAdmin, setIsAdmin] = useState(row.isAdmin);
  const [isActive, setIsActive] = useState(row.isActive);
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const clerkHealthy = row.isActive
    ? row.clerkState === 'registered' || row.clerkState === 'invited'
    : row.clerkState !== 'invited';
  const clerkLabel = row.isActive
    ? row.clerkState === 'registered'
      ? 'Clerk account'
      : row.clerkState === 'invited'
        ? 'Invitation pending'
        : row.clerkState === 'expired'
          ? 'Invitation expired'
          : 'Invitation needed'
    : row.clerkState === 'registered'
      ? 'Clerk account retained'
      : row.clerkState === 'invited'
        ? 'Invite must be revoked'
        : 'No active invitation';

  function run(work: () => Promise<AdminActionResult>) {
    start(async () => {
      const next = await work();
      setResult(next);
      if (next.ok) router.refresh();
    });
  }

  return (
    <article className={`member-card${row.isActive ? '' : ' inactive'}`}>
      <div className="member-heading">
        <div>
          <strong>{row.displayName || row.email}</strong>
          {row.displayName && <span>{row.email}</span>}
        </div>
        <div className="status-cluster">
          <span className={`status-dot ${row.isActive ? 'good' : 'muted'}`}>
            {row.isActive ? 'Active' : 'Inactive'}
          </span>
          <span className={`status-dot ${clerkHealthy ? (row.isActive ? 'good' : 'muted') : 'bad'}`}>
            {clerkLabel}
          </span>
          <span className={`status-dot ${row.profileId ? 'good' : row.clerkState === 'registered' ? 'bad' : 'muted'}`}>
            {row.profileId ? 'Profile ready' : row.clerkState === 'registered' ? 'Profile needs repair' : 'Not registered'}
          </span>
        </div>
      </div>

      <div className="member-fields">
        <label>
          <span>ESPN team</span>
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="">Unassigned</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        <label className="check-field">
          <input type="checkbox" checked={isAdmin}
                 onChange={(event) => setIsAdmin(event.target.checked)} />
          Commissioner
        </label>
        <label className="check-field">
          <input type="checkbox" checked={isActive}
                 onChange={(event) => setIsActive(event.target.checked)} />
          Active member
        </label>
      </div>

      <div className="member-actions">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => saveMembership({
            email: row.email,
            season: row.season,
            espnTeamId: teamId ? Number(teamId) : null,
            isAdmin,
            isActive,
          }))}
        >
          {pending ? 'Working…' : 'Save member'}
        </button>
        <button type="button" className="btn-quiet" disabled={pending}
                onClick={() => run(() => repairMembershipSync(row.email))}>
          Repair / resend invite
        </button>
        {row.profileId && (
          <span className="member-recap">
            Recap: {row.recapEnabled ? 'on' : 'off'}
          </span>
        )}
      </div>
      <Result result={result} />
    </article>
  );
}

export function MembershipManager({
  rows,
  teams,
  season,
  clerkError,
}: {
  rows: MembershipRow[];
  teams: MembershipTeam[];
  season: number;
  clerkError: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState('');
  const [teamId, setTeamId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [result, setResult] = useState<AdminActionResult | null>(null);

  function add(event: React.FormEvent) {
    event.preventDefault();
    const input: MembershipInput = {
      email,
      season,
      espnTeamId: teamId ? Number(teamId) : null,
      isAdmin,
      isActive: true,
      notify: true,
    };
    start(async () => {
      const next = await saveMembership(input);
      setResult(next);
      if (next.ok) {
        setEmail('');
        setTeamId('');
        setIsAdmin(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      {clerkError && (
        <div className="callout warning">
          Clerk accounts and invitations could not be read right now. Database
          membership is still shown; use Repair / resend invite after Clerk is available.
        </div>
      )}

      <form className="card add-member" onSubmit={add}>
        <div className="section-kicker">New invitation</div>
        <h2>Add a league member</h2>
        <div className="form-grid">
          <label>
            <span>Email</span>
            <input type="email" value={email} required autoComplete="email"
                   placeholder="member@example.com"
                   onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span>ESPN team</span>
            <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              <option value="">Unassigned</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="inline-checks">
          <label><input type="checkbox" checked={isAdmin}
                        onChange={(event) => setIsAdmin(event.target.checked)} /> Commissioner</label>
        </div>
        <button type="submit" disabled={pending}>{pending ? 'Inviting…' : 'Add member & send invite'}</button>
        <Result result={result} />
      </form>

      <div className="member-list">
        {rows.map((row) => <MemberEditor key={row.email} row={row} teams={teams} />)}
      </div>
    </>
  );
}
