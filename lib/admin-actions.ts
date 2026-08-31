'use server';

import { revalidatePath } from 'next/cache';

import { adminProfile } from './admin.ts';
import { asUser } from './db.ts';
import { syncClerkMember } from './clerk-admin.ts';
import type { ClerkMember } from './clerk-member-state.ts';
import { provisionProfile, syncProfileMembership } from './provisioner.ts';

export interface AdminActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface MembershipInput {
  email: string;
  season: number;
  espnTeamId: number | null;
  isAdmin: boolean;
  isActive: boolean;
  notify?: boolean;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/last active administrator/i.test(message)) {
    return 'Promote another commissioner before deactivating or demoting the last one.';
  }
  if (/row-level security|permission denied|not an admin/i.test(message)) {
    return 'Your account is not authorized to manage league membership.';
  }
  if (/PROVISIONER_DATABASE_URL/i.test(message)) {
    return 'The database membership was saved, but the profile could not refresh. Check PROVISIONER_DATABASE_URL, then use Repair sync.';
  }
  if (/Clerk|invitation|Unprocessable Entity|fetch failed/i.test(message)) {
    return 'The database membership was saved, but Clerk did not synchronize. Use Repair sync when Clerk is available.';
  }
  return 'Membership could not be updated. No broader access was granted.';
}

async function syncMembershipDependencies(
  email: string,
  active: boolean,
  notify: boolean
): Promise<ClerkMember> {
  const clerk = await syncClerkMember(email, active, notify);
  if (active && clerk.userId) {
    // Repairs a missed user.created webhook as well as refreshing an existing
    // profile after a team/admin change.
    await provisionProfile(clerk.userId, email, clerk.displayName);
  } else {
    await syncProfileMembership(email);
  }
  return clerk;
}

export async function saveMembership(input: MembershipInput): Promise<AdminActionResult> {
  const admin = await adminProfile();
  if (!admin) return { ok: false, error: 'Not authorized.' };

  const email = input.email.trim().toLowerCase();
  const season = Number(input.season);
  const teamId = input.espnTeamId === null ? null : Number(input.espnTeamId);
  if (!validEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!Number.isInteger(season) || season < 2005 || season > 2100) {
    return { ok: false, error: 'Choose a valid season.' };
  }
  if (teamId !== null && (!Number.isInteger(teamId) || teamId < 1)) {
    return { ok: false, error: 'Choose a valid ESPN team.' };
  }

  try {
    const [rows] = await asUser<{ email: string }>((q) => [
      q(
        `insert into public.league_allowlist
           (email, season, espn_team_id, is_admin, is_active)
         select $1::citext, $2, $3::int, $4, $5
          where $3::int is null or exists (
            select 1 from public.teams
             where season = $2 and espn_team_id = $3::int
          )
         on conflict (email) do update set
           season = excluded.season,
           espn_team_id = excluded.espn_team_id,
           is_admin = excluded.is_admin,
           is_active = excluded.is_active
         returning email::text`,
        [email, season, teamId, Boolean(input.isAdmin), Boolean(input.isActive)]
      ),
    ]);
    if (!rows?.length) {
      return { ok: false, error: 'That ESPN team does not exist in the selected season.' };
    }

    // The database is authoritative and is updated first. Deactivation takes
    // effect there immediately even if either downstream synchronizer is down.
    const clerk = await syncMembershipDependencies(
      email,
      Boolean(input.isActive),
      input.notify ?? true
    );

    revalidatePath('/admin');
    revalidatePath('/admin/members');
    revalidatePath('/me');
    return {
      ok: true,
      message: !input.isActive
        ? 'Member deactivated; pending invitation links were revoked.'
        : clerk.state === 'registered'
          ? 'Membership and the existing Clerk account are in sync.'
          : 'Membership saved and Clerk invitation sent.',
    };
  } catch (error) {
    revalidatePath('/admin/members');
    return { ok: false, error: safeError(error) };
  }
}

export async function repairMembershipSync(emailValue: string): Promise<AdminActionResult> {
  const admin = await adminProfile();
  if (!admin) return { ok: false, error: 'Not authorized.' };
  const email = emailValue.trim().toLowerCase();
  if (!validEmail(email)) return { ok: false, error: 'Enter a valid email address.' };

  try {
    const [rows] = await asUser<{ is_active: boolean }>((q) => [
      q(
        `select is_active from public.league_allowlist where email = $1::citext`,
        [email]
      ),
    ]);
    const member = rows?.[0];
    if (!member) return { ok: false, error: 'That email is not in the league database.' };

    const clerk = await syncMembershipDependencies(email, member.is_active, true);
    revalidatePath('/admin/members');
    return {
      ok: true,
      message: !member.is_active
        ? 'Inactive membership confirmed; pending invitation links were revoked.'
        : clerk.state === 'registered'
          ? 'Database profile and Clerk account are in sync.'
          : 'A fresh Clerk invitation was sent.',
    };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}
