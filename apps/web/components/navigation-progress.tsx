'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * A thin bar at the top of the page from the moment an internal link is clicked (or a GET
 * form is submitted) until the new page arrives, so a slow server render never looks like
 * a frozen site. Purely visual: hidden from assistive technology.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [active, setActive] = useState(false);

  // The new URL has rendered: hide the bar.
  useEffect(() => setActive(false), [pathname, search]);

  useEffect(() => {
    const current = () => window.location.pathname + window.location.search;
    const start = (url: URL) => {
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === current()) return;
      setActive(true);
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      start(new URL(href, window.location.href));
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || event.defaultPrevented || form.method.toLowerCase() !== 'get') return;
      const url = new URL(form.action || window.location.href);
      url.search = new URLSearchParams(
        new FormData(form) as unknown as Record<string, string>,
      ).toString();
      start(url);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('submit', onSubmit);
    };
  }, []);

  // Never leave the bar up if a navigation was cancelled.
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), 15_000);
    return () => clearTimeout(timer);
  }, [active]);

  return active ? <div aria-hidden="true" className="route-progress" /> : null;
}
