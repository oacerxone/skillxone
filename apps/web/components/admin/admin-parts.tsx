import Link from 'next/link';

/** Small building blocks for the admin pages: plain HTML forms that post with a CSRF token. */

export function AdminForm({
  action,
  csrf,
  back,
  children,
  className = '',
}: {
  action: string;
  csrf: string;
  back: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form method="post" action={action} className={`flex flex-wrap items-end gap-2 ${className}`}>
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="back" value={back} />
      {children}
    </form>
  );
}

export function Submit({
  name,
  value,
  children,
}: {
  name?: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className="h-8 rounded-md border border-border-strong bg-bg px-3 text-[13px] font-medium hover:bg-bg-muted focus-visible:outline-2 focus-visible:outline-focus"
    >
      {children}
    </button>
  );
}

export function NoteField({
  label = 'Note',
  required = false,
  id,
}: {
  label?: string;
  required?: boolean;
  id: string;
}) {
  return (
    <label className="flex min-w-[12rem] flex-1 flex-col text-[12px] text-text-muted" htmlFor={id}>
      {label}
      {required ? ' (required, public)' : ''}
      <input
        id={id}
        name="note"
        required={required}
        minLength={required ? 5 : undefined}
        maxLength={1000}
        className="mt-1 h-8 rounded-md border border-border-strong bg-bg px-2 text-[13px] text-text"
      />
    </label>
  );
}

export function Done({ done }: { done?: string }) {
  if (!done || !/^[a-z-]{1,40}$/.test(done)) return null;
  return (
    <p role="status" className="mb-4 rounded-sm bg-bg-muted px-3 py-2 text-[13px]">
      Saved: {done.replace(/-/g, ' ')}.
    </p>
  );
}

export function AdminTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-[22px] font-semibold leading-8">{title}</h1>
      {children && (
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-text-muted">{children}</p>
      )}
    </header>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-text-muted">{children}</p>;
}

export function StatusFilter({
  base,
  current,
  options,
}: {
  base: string;
  current: string;
  options: readonly string[];
}) {
  return (
    <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-3 text-[13px]">
      {options.map((option) => (
        <Link
          key={option}
          href={`${base}?status=${option}`}
          aria-current={current === option ? 'page' : undefined}
          className={current === option ? 'font-semibold' : 'link'}
        >
          {option}
        </Link>
      ))}
    </nav>
  );
}
