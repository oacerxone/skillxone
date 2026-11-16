import Link from 'next/link';
import type { VerificationState } from '@skillxone/shared/constants';

const VARIANTS: Record<
  VerificationState,
  { label: string; className: string; title: string; icon: React.ReactNode }
> = {
  VERIFIED: {
    label: 'Verified',
    className: 'bg-verified-bg text-verified-fg',
    title:
      'This exact version passed the published verification policy. Not a guarantee of safety.',
    icon: (
      <>
        <path d="M6 1.2 10 2.6v3c0 2.4-1.6 4.1-4 5.2-2.4-1.1-4-2.8-4-5.2v-3L6 1.2Z" />
        <path d="m4.2 6 1.3 1.3L8 4.8" />
      </>
    ),
  },
  UNVERIFIED: {
    label: 'Unverified',
    className: 'bg-unverified-bg text-unverified-fg',
    title:
      'No completed assessment exists for the current version. This does not mean it is unsafe.',
    icon: <circle cx="6" cy="6" r="4.3" strokeDasharray="2 1.6" />,
  },
  FLAGGED: {
    label: 'Flagged',
    className: 'bg-flagged-bg text-flagged-fg',
    title: 'The current version has documented findings. See the security report.',
    icon: (
      <>
        <path d="M6 1.5 11 10.5H1L6 1.5Z" />
        <path d="M6 5v2.4M6 8.9v.1" />
      </>
    ),
  },
};

/** State is conveyed by icon and text, never by colour alone. */
export function VerificationBadge({ state, href }: { state: VerificationState; href?: string }) {
  const variant = VARIANTS[state];
  const content = (
    <>
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {variant.icon}
      </svg>
      {variant.label}
    </>
  );
  const className = `inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] font-medium leading-4 ${variant.className}`;

  return href ? (
    <Link href={href} className={`${className} hover:underline`} title={variant.title}>
      {content}
    </Link>
  ) : (
    <span className={className} title={variant.title}>
      {content}
    </span>
  );
}
