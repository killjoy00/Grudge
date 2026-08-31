'use client';
import { usePathname } from 'next/navigation';

const TABS = [
  ['/', 'This week'],
  ['/standings', 'Standings'],
  ['/rankings', 'Power'],
  ['/odds', 'Odds'],
  ['/predictions', 'Predictions'],
  ['/history', 'History'],
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.map(([href, label]) => (
        <a key={href} href={href} className={path === href ? 'on' : ''}>
          {label}
        </a>
      ))}
    </nav>
  );
}
