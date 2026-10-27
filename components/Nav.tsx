'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const TABS = [
  ['/', 'Scoreboard'],
  ['/standings/season/current', 'Standings'],
  ['/rankings', 'Power Rankings'],
  ['/predictions', 'Predictions'],
  ['/trades', 'Trades'],
  ['/players', 'Players'],
  ['/history/range/all', 'History'],
];

export function Nav() {
  const path = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // The seven tabs intentionally scroll on a phone. Keep the current page in
  // view after navigation instead of always resetting the strip to Scoreboard.
  // Manual scrollLeft avoids scrollIntoView moving the sticky header vertically.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;

    const max = nav.scrollWidth - nav.clientWidth;
    const centered = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollLeft = Math.max(0, Math.min(max, centered));
  }, [path]);

  return (
    <nav className="tabs" ref={navRef}>
      {TABS.map(([href, label]) => {
        const active = href === '/'
          ? path === '/'
          : href === '/history/range/all'
            ? path.startsWith('/history') || path.startsWith('/franchise/') || path.startsWith('/manager/') || path.startsWith('/grudge/') || path.startsWith('/rivalry/')
            : href === '/standings/season/current'
              ? path.startsWith('/standings')
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
