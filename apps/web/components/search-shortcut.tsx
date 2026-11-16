'use client';

import { useEffect } from 'react';

/**
 * Pressing "/" focuses the page's search field (the one in the main content if present,
 * otherwise the header's). Ignored while typing in a field and when a modifier is held.
 */
export function SearchShortcut() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      const field =
        document.querySelector<HTMLInputElement>('main [data-search-input]') ??
        document.querySelector<HTMLInputElement>('[data-search-input]');
      if (!field) return;
      event.preventDefault();
      field.focus();
      field.select();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
