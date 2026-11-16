'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/navigation';
import { NavIcon } from './nav-icon';

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Primary navigation links with the current section marked (aria-current="page"). */
export function NavLinks({ items, variant }: { items: NavItem[]; variant: 'bar' | 'menu' }) {
  const pathname = usePathname() ?? '/';
  return (
    <>
      {items.map((item) => {
        const active = !item.external && isActive(pathname, item.href);
        const className = variant === 'bar' ? 'nav-pill' : 'menu-link';
        const content = (
          <>
            {item.icon && <NavIcon name={item.icon} size={15} className="nav-icon" />}
            <span>{item.label}</span>
          </>
        );
        return item.external ? (
          <a key={item.href} href={item.href} className={className} rel="noopener noreferrer">
            {content}
          </a>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className={className}
            aria-current={active ? 'page' : undefined}
          >
            {content}
          </Link>
        );
      })}
    </>
  );
}
