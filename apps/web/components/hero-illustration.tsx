/**
 * Decorative hero illustration: a terminal that "types" an install command next to a scan
 * card. It is a picture of the workflow, not data — the command and file names are generic
 * placeholders, and the whole figure is hidden from assistive technology. The web app never
 * runs install commands; this only shows what a user would run on their own machine.
 */
export function HeroIllustration() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[460px] select-none">
      <div className="term float">
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
          <span className="size-2.5 rounded-full bg-flagged-fg/70" />
          <span className="size-2.5 rounded-full bg-warning-fg/70" />
          <span className="size-2.5 rounded-full bg-verified-fg/70" />
          <span className="ml-2 font-mono text-[11px] text-text-subtle">~/project</span>
        </div>
        <div className="relative space-y-1.5 px-4 pt-4 pb-4 sm:pb-24 font-mono text-[12.5px] leading-5">
          <div className="scan-beam" />
          <p className="text-text">
            <span className="text-accent">$ </span>
            <span className="term-type">npx skills add owner/repo --skill name</span>
            <span className="term-caret" />
          </p>
          <p className="term-line text-text-muted" style={{ animationDelay: '2.1s' }}>
            <span className="text-verified-fg">✓</span> resolved commit a1b2c3d
          </p>
          <p className="term-line text-text-muted" style={{ animationDelay: '2.5s' }}>
            <span className="text-verified-fg">✓</span> security report: no blocking findings
          </p>
          <p className="term-line text-text-muted" style={{ animationDelay: '2.9s' }}>
            <span className="text-verified-fg">✓</span> installed to .claude/skills/name
          </p>
        </div>
      </div>

      <div
        className="term reveal absolute -bottom-6 -left-4 hidden w-[230px] p-3 sm:block"
        style={{ '--i': 6 } as React.CSSProperties}
      >
        <div className="flex items-center gap-3">
          <span className="relative inline-flex size-9 items-center justify-center rounded-full bg-verified-bg text-verified-fg">
            <span className="pulse-ring" />
            <svg
              width="18"
              height="18"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 1.2 10 2.6v3c0 2.4-1.6 4.1-4 5.2-2.4-1.1-4-2.8-4-5.2v-3L6 1.2Z" />
              <path d="m4.2 6 1.3 1.3L8 4.8" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-text">Static scan</p>
            <p className="text-[11px] text-text-muted">8 checks · pinned version</p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          {[92, 78, 64].map((w, i) => (
            <div key={w} className="h-1.5 overflow-hidden rounded-full bg-bg-muted">
              <div
                className="reveal h-full rounded-full bg-accent/60"
                style={{ width: `${w}%`, '--i': 8 + i } as React.CSSProperties}
              />
            </div>
          ))}
        </div>
      </div>

      <div
        className="term reveal absolute -right-3 -top-6 hidden px-3 py-2 sm:block"
        style={{ '--i': 4 } as React.CSSProperties}
      >
        <p className="flex items-center gap-2 text-[11px] text-text-muted">
          <span className="inline-block size-1.5 rounded-full bg-accent" />
          Claude Code · Codex
        </p>
      </div>
    </div>
  );
}
