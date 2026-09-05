'use client';
import { usePathname } from 'next/navigation';

const TABS = [
  ['/', 'Scoreboard'],
  ['/standings', 'Standings'],
  ['/rankings', 'Power Rankings'],
  ['/odds', 'Odds'],
  ['/predictions', 'Predictions'],
  ['/trades', 'Trades'],
  ['/history', 'History'],
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.map(([href, label]) => {
        const active = href === '/'
          ? path === '/'
          : href === '/history'
            ? path.startsWith('/history') || path.startsWith('/franchise/') || path.startsWith('/manager/') || path.startsWith('/rivalry/')
            : path === href || path.startsWith(`${href}/`);
        return (
          <a key={href} href={href} className={active ? 'on' : ''}
             aria-current={active ? 'page' : undefined}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
