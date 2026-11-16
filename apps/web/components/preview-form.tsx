'use client';

import { useState } from 'react';

/**
 * Wraps a form whose backend does not exist yet (submissions and reports arrive in
 * Phase 8). Native validation runs as normal; a valid submission is NOT sent anywhere,
 * and the visitor is told so instead of being shown a false success message.
 */
export function PreviewForm({
  children,
  submitLabel,
  notSentMessage,
}: {
  children: React.ReactNode;
  submitLabel: string;
  notSentMessage: string;
}) {
  const [attempted, setAttempted] = useState(false);

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
      }}
    >
      {children}
      <div>
        <button type="submit" className="btn btn-primary">
          {submitLabel}
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-[13px] text-warning-fg">
        {attempted && <span className="rounded-sm bg-warning-bg px-2 py-1">{notSentMessage}</span>}
      </p>
    </form>
  );
}
