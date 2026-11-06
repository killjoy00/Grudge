import { redirect } from 'next/navigation';
import { previewWithoutClerk } from '../lib/clerk-config.ts';

// No database work on /; the weekly report is rendered once and served by CDN.
export default function Home() {
  redirect(previewWithoutClerk() ? '/preview' : '/scoreboard/current');
}
