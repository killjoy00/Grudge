import { redirect } from 'next/navigation';

// No database work on /; the weekly report is rendered once and served by CDN.
export default function Home() {
  redirect('/scoreboard/current');
}
