import Link from 'next/link';
import { REPOSITORY_URL, secondaryNav } from '@/lib/navigation';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-6 text-[13px] text-text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          Open source under Apache-2.0. Indexed skills remain under their own licenses.{' '}
          <a href={REPOSITORY_URL} className="link" rel="noopener noreferrer">
            Source
          </a>
        </p>
        <nav aria-label="Secondary" className="flex flex-wrap gap-x-4 gap-y-1">
          {secondaryNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-text">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
