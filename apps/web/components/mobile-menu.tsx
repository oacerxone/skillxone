'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Mobile navigation as a native <details> disclosure, so it opens without JavaScript.
 * With JavaScript it also closes after navigating and when Escape is pressed.
 */
export function MobileMenu({
  children,
  summary = 'Menu',
}: {
  children: React.ReactNode;
  summary?: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const details = ref.current;
      if (event.key !== 'Escape' || !details?.open) return;
      details.open = false;
      details.querySelector('summary')?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <details ref={ref} className="relative lg:hidden">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-bg/60 px-3 text-[13px] text-text transition-colors hover:bg-bg-muted [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      {children}
    </details>
  );
}
