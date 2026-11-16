'use client';

import { useState } from 'react';

/**
 * A form that posts its fields as JSON to one of the public write endpoints and reports the
 * server's answer. Fixed values (a skill id, say) are passed in `extra`, never read from the URL.
 */
export function JsonForm({
  endpoint,
  submitLabel,
  extra = {},
  csrf,
  successMessage,
  duplicateMessage,
  children,
}: {
  endpoint: string;
  submitLabel: string;
  extra?: Record<string, string>;
  /** CSRF token when the visitor is signed in; the endpoint requires it with a session cookie. */
  csrf?: string;
  successMessage: string;
  duplicateMessage: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'ok' | 'error'; text: string }>({
    kind: 'idle',
    text: '',
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body: Record<string, string> = { ...extra };
    for (const [key, value] of new FormData(form))
      if (typeof value === 'string' && value.trim()) body[key] = value;
    setState({ kind: 'sending', text: 'Sending…' });
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        duplicate?: boolean;
        error?: { message?: string };
      };
      if (response.ok) {
        setState({ kind: 'ok', text: result.duplicate ? duplicateMessage : successMessage });
        if (!result.duplicate) form.reset();
      } else {
        setState({
          kind: 'error',
          text: result.error?.message ?? 'Something went wrong. Try again later.',
        });
      }
    } catch {
      setState({
        kind: 'error',
        text: 'The request did not reach the server. Check your connection.',
      });
    }
  }

  return (
    <form className="flex max-w-xl flex-col gap-4" onSubmit={onSubmit}>
      {children}
      <div>
        <button type="submit" className="btn btn-primary" disabled={state.kind === 'sending'}>
          {submitLabel}
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-[13px]">
        {state.kind === 'ok' && (
          <span className="rounded-sm bg-bg-muted px-2 py-1">{state.text}</span>
        )}
        {state.kind === 'error' && (
          <span className="rounded-sm bg-warning-bg px-2 py-1 text-warning-fg">{state.text}</span>
        )}
        {state.kind === 'sending' && <span className="text-text-muted">{state.text}</span>}
      </p>
    </form>
  );
}
