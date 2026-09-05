import 'server-only';

import { unstable_cache } from 'next/cache';
import { getFranchiseHistory, getManagerHistory } from './queries.ts';

/** The History landing page is a directory, not a second record book. */
export const getCachedHistoryDirectory = unstable_cache(
  async () => Promise.all([getFranchiseHistory(), getManagerHistory()]),
  ['history-directory'],
  { revalidate: 86400 }
);
