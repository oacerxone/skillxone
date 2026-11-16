'use client';

import { useEffect, useRef, useState } from 'react';

/** Copies `text` to the clipboard and announces the result to screen readers. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      // Clipboard access can be denied (insecure origin, permissions). Say so plainly.
      setStatus('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 2000);
  }

  return (
    <>
      <button type="button" className="btn" onClick={copy}>
        {status === 'copied' ? 'Copied' : label}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === 'copied' && 'Command copied to clipboard'}
        {status === 'failed' && 'Could not copy. Select the command and copy it manually.'}
      </span>
    </>
  );
}
