import { redirect } from 'next/navigation';

// Retain existing links while rendering the public report only once per week.
export default function LegacyReport() {
  redirect('/players/records/weekly');
}
