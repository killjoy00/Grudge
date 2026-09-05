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
  ['/history/vault', 'The Vault'],
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.map(([href, label]) => {
        const active = href === '/'
          ? path === '/'
          : href === '/history'
            ? path === '/history' || (path.startsWith('/history/') && !path.startsWith('/history/vault'))
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
