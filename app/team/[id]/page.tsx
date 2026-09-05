import { notFound, redirect } from 'next/navigation';

import { getCachedFranchiseKeyForEspnId } from '../../../lib/history-cache.ts';
import { franchiseHref } from '../../../lib/history-format.ts';

export const revalidate = 86400;

export default async function TeamRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId < 1) notFound();

  const franchiseKey = await getCachedFranchiseKeyForEspnId(teamId);
  if (!franchiseKey) notFound();

  redirect(franchiseHref(franchiseKey));
}
