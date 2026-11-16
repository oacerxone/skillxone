/**
 * Inline SVG icons (no icon font, no network request, CSP-safe). Stroke icons inherit
 * `currentColor`; every icon is decorative (`aria-hidden`), so the surrounding control must
 * carry the accessible name.
 */
type IconProps = { className?: string; size?: number };

function Stroke({ children, className, size = 16 }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export const CompassIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
  </Stroke>
);
export const GridIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Stroke>
);
export const FlameIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 21c3.9 0 6.5-2.6 6.5-6.2 0-3.4-2.4-5.6-3.6-8.3-.4 1.9-1.4 3-2.6 3.7C12.6 7.4 11 5 8.6 3.5c.3 3-1.6 4.9-2.6 6.6A7.4 7.4 0 0 0 5.5 14.8C5.5 18.4 8.1 21 12 21Z" />
    <path d="M12 21c-1.7 0-2.8-1.2-2.8-2.8 0-1.8 1.6-2.7 2.8-4.4 1.2 1.7 2.8 2.6 2.8 4.4 0 1.6-1.1 2.8-2.8 2.8Z" />
  </Stroke>
);
export const ShieldCheckIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3 19.5 5.8v5.4c0 4.6-3.1 7.9-7.5 9.8-4.4-1.9-7.5-5.2-7.5-9.8V5.8L12 3Z" />
    <path d="m8.8 12 2.2 2.2 4.3-4.4" />
  </Stroke>
);
export const LayersIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5Z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16 8.5 4.5 8.5-4.5" />
  </Stroke>
);
export const UploadIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 15V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4.5 15v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3" />
  </Stroke>
);
export const SparklesIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M10 3.5 11.6 8a2 2 0 0 0 1.3 1.3l4.6 1.6-4.6 1.6a2 2 0 0 0-1.3 1.3L10 18.4l-1.6-4.6A2 2 0 0 0 7.1 12.5L2.5 10.9l4.6-1.6A2 2 0 0 0 8.4 8L10 3.5Z" />
    <path d="M18.5 3v4M16.5 5h4M19 16v3M17.5 17.5h3" />
  </Stroke>
);
export const BookIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4.5 5.5A2 2 0 0 1 6.5 3.5h13v14h-13a2 2 0 0 0-2 2v-14Z" />
    <path d="M4.5 19.5a2 2 0 0 0 2 2h13v-4" />
  </Stroke>
);
export const CodeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" />
  </Stroke>
);
export const HeartIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z" />
  </Stroke>
);
export const InfoIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.1" />
  </Stroke>
);
export const FlagIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5" />
  </Stroke>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Stroke>
);
export const ArrowUpIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Stroke>
);
export const TerminalIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5" />
  </Stroke>
);
export const SearchIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Stroke>
);
export const MenuIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Stroke>
);
export const LockIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Stroke>
);
export const PinIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5l-1-6ZM12 13v7.5" />
  </Stroke>
);

/** Filled star (used for GitHub stars). */
export function StarIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9L12 2.8Z" />
    </svg>
  );
}

/** The GitHub mark, used only to link to GitHub. */
export function GitHubIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/** Brand mark: stacked chevrons on an accent tile. */
export function LogoMark({ size = 28, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
    >
      <defs>
        <linearGradient id="sx-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="color-mix(in oklab, var(--accent) 70%, var(--text))" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="url(#sx-logo-g)" />
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8"
        fill="none"
        stroke="white"
        strokeOpacity=".25"
      />
      <path
        className="logo-chevrons"
        d="M9.5 12 16 8.5l6.5 3.5M9.5 17 16 20.5l6.5-3.5M9.5 22 16 25.5l6.5-3.5"
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const FlaskIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M9.5 3.5h5M10 3.5v5.2L4.8 18a1.8 1.8 0 0 0 1.6 2.6h11.2a1.8 1.8 0 0 0 1.6-2.6L14 8.7V3.5" />
    <path d="M7.4 14.5h9.2" />
  </Stroke>
);
export const ServerIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="4" width="17" height="6.5" rx="2" />
    <rect x="3.5" y="13.5" width="17" height="6.5" rx="2" />
    <path d="M7.5 7.25h.01M7.5 16.75h.01M11 7.25h5.5M11 16.75h5.5" />
  </Stroke>
);
export const DatabaseIcon = (p: IconProps) => (
  <Stroke {...p}>
    <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
    <path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
  </Stroke>
);
export const PaletteIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.9 1.8-1.8 0-1.3-1.1-1.6-1.1-2.7 0-.9.7-1.5 1.6-1.5h2.2a4 4 0 0 0 4-4C20.5 6.6 16.7 3.5 12 3.5Z" />
    <path d="M7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01" />
  </Stroke>
);
export const FileTextIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5l-5-5Z" />
    <path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" />
  </Stroke>
);
export const ListChecksIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m3.5 6.5 1.5 1.5 3-3M3.5 13.5 5 15l3-3M11.5 7h9M11.5 14h9M11.5 19.5h9" />
  </Stroke>
);
export const TelescopeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m3.5 12.5 13-6.5 2 4-13 6.5-2-4Z" />
    <path d="m16.5 6 3-1.5 2 4-3 1.5M10 14.5l-2.5 6M12 13.5l2.5 7" />
  </Stroke>
);
export const BotIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="4" y="8" width="16" height="11.5" rx="3" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5M2 13v2M22 13v2" />
  </Stroke>
);
export const PackageIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9L12 3Z" />
    <path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9M7.8 5.2l8.5 4.6" />
  </Stroke>
);
export const UsersIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.3c2.1.7 3.5 2.8 3.5 5.7" />
  </Stroke>
);
