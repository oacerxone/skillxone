import {
  BookIcon,
  BotIcon,
  CodeIcon,
  DatabaseIcon,
  FileTextIcon,
  FlaskIcon,
  ListChecksIcon,
  PaletteIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TelescopeIcon,
} from './icons';

/**
 * Decorative art: category tiles and generated avatars. Colours come from the `--art-*`
 * tokens. Everything here is aria-hidden; names are always given in text next to it.
 */
const ART = ['art-1', 'art-2', 'art-3', 'art-4', 'art-5', 'art-6', 'art-7', 'art-8'] as const;
type Art = (typeof ART)[number];

type IconComponent = (p: { size?: number; className?: string }) => React.ReactNode;

const CATEGORY_ART: Record<string, { icon: IconComponent; art: Art; art2: Art }> = {
  development: { icon: CodeIcon, art: 'art-1', art2: 'art-6' },
  testing: { icon: FlaskIcon, art: 'art-2', art2: 'art-7' },
  devops: { icon: ServerIcon, art: 'art-6', art2: 'art-1' },
  data: { icon: DatabaseIcon, art: 'art-7', art2: 'art-2' },
  documentation: { icon: BookIcon, art: 'art-3', art2: 'art-8' },
  design: { icon: PaletteIcon, art: 'art-4', art2: 'art-5' },
  security: { icon: ShieldCheckIcon, art: 'art-5', art2: 'art-1' },
  documents: { icon: FileTextIcon, art: 'art-8', art2: 'art-3' },
  productivity: { icon: ListChecksIcon, art: 'art-3', art2: 'art-7' },
  research: { icon: TelescopeIcon, art: 'art-6', art2: 'art-5' },
  agents: { icon: BotIcon, art: 'art-5', art2: 'art-4' },
};
const FALLBACK = { icon: SparklesIcon, art: 'art-1' as Art, art2: 'art-5' as Art };

export function categoryArt(slug: string) {
  return CATEGORY_ART[slug] ?? FALLBACK;
}

/** Rounded gradient tile with the category's icon. */
export function CategoryTile({ slug, size = 40 }: { slug: string; size?: number }) {
  const { icon: Icon, art, art2 } = categoryArt(slug);
  return (
    <span
      aria-hidden="true"
      className="art-tile"
      style={
        {
          width: size,
          height: size,
          '--a1': `var(--${art})`,
          '--a2': `var(--${art2})`,
        } as React.CSSProperties
      }
    >
      <Icon size={Math.round(size * 0.48)} />
    </span>
  );
}

/** Small FNV-1a hash: stable across server and client renders. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Generated avatar for a repository owner: a two-colour gradient with a geometric motif and
 * the owner's initials. Deterministic, made locally (no external image request).
 */
export function Avatar({
  name,
  size = 32,
  rounded = 'md',
}: {
  name: string;
  size?: number;
  rounded?: 'md' | 'full';
}) {
  const h = hash(name.toLowerCase());
  const a1 = ART[h % ART.length]!;
  const a2 =
    ART[(h >>> 3) % ART.length === h % ART.length ? (h + 1) % ART.length : (h >>> 3) % ART.length]!;
  const motif = (h >>> 7) % 3;
  const initials =
    name
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?';
  const id = `av-${h.toString(36)}`;
  const radius = rounded === 'full' ? 50 : 22;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className="avatar"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`var(--${a1})`} />
          <stop offset="1" stopColor={`var(--${a2})`} />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          <rect width="100" height="100" rx={radius} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="100" height="100" fill={`url(#${id})`} />
        {motif === 0 && <circle cx="85" cy="15" r="38" fill="white" fillOpacity=".16" />}
        {motif === 1 && <path d="M0 70 L100 30 L100 100 L0 100Z" fill="white" fillOpacity=".14" />}
        {motif === 2 && (
          <>
            <circle cx="20" cy="85" r="30" fill="white" fillOpacity=".14" />
            <circle cx="88" cy="10" r="18" fill="white" fillOpacity=".12" />
          </>
        )}
        <text
          x="50"
          y="50"
          dy=".35em"
          textAnchor="middle"
          fontFamily="var(--ff-sans)"
          fontWeight="650"
          fontSize={initials.length > 1 ? 38 : 46}
          fill="var(--accent-fg)"
        >
          {initials}
        </text>
      </g>
    </svg>
  );
}

/** Line-art illustration for empty states: a magnifier over stacked cards. */
export function EmptyIllustration() {
  return (
    <svg aria-hidden="true" width="140" height="104" viewBox="0 0 140 104" className="mx-auto">
      <rect x="22" y="22" width="84" height="58" rx="10" fill="var(--bg-muted)" />
      <rect
        x="30"
        y="12"
        width="84"
        height="58"
        rx="10"
        fill="var(--bg-subtle)"
        stroke="var(--border-strong)"
      />
      <rect x="42" y="26" width="40" height="6" rx="3" fill="var(--border-strong)" />
      <rect x="42" y="38" width="58" height="5" rx="2.5" fill="var(--border)" />
      <rect x="42" y="48" width="48" height="5" rx="2.5" fill="var(--border)" />
      <circle cx="98" cy="70" r="16" fill="var(--bg)" stroke="var(--accent)" strokeWidth="4" />
      <path d="m110 82 12 12" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="18" cy="30" r="3" fill="var(--art-3)" />
      <circle cx="124" cy="22" r="4" fill="var(--art-2)" />
      <path d="M12 74h8M16 70v8" stroke="var(--art-4)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
