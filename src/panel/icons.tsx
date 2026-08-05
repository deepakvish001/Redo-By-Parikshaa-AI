/**
 * The panel's icon set.
 *
 * Inline SVG rather than an icon font or sprite sheet: there are a dozen of
 * them, they all inherit `currentColor`, and an extension page cannot fetch
 * anything external anyway. Every icon is drawn on a 16×16 grid so they line up
 * without per-icon nudging.
 */

type IconProps = { size?: number; className?: string };

function Svg({
  size = 14,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.75 4.25A1.25 1.25 0 0 1 3 3h3l1.5 1.75H13a1.25 1.25 0 0 1 1.25 1.25v6A1.25 1.25 0 0 1 13 13.25H3A1.25 1.25 0 0 1 1.75 12z" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8l2.25 1.5" />
    </Svg>
  );
}

export function FlameIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.75s3.5 2.75 3.5 6a3.5 3.5 0 1 1-7 0c0-1.25.5-2.25 1.25-3 0 1 .5 1.75 1.25 1.75C8.75 6.5 8 4 8 1.75Z" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5 14.5 13.5h-13z" />
      <path d="M8 6.75v2.5M8 11.5h.01" />
    </Svg>
  );
}

export function GithubIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.25 13.5c-3 .9-3-1.6-4.25-2m8.5 4v-2.6c0-.75-.1-1.05-.55-1.45 2-.22 3.8-1 3.8-4.05a3.1 3.1 0 0 0-.85-2.15 2.9 2.9 0 0 0-.1-2.15s-.7-.22-2.35.85a8 8 0 0 0-4 0C4.8 2.4 4.1 2.6 4.1 2.6a2.9 2.9 0 0 0-.1 2.15A3.1 3.1 0 0 0 3.15 7c0 3 1.8 3.8 3.8 4.05-.35.3-.5.75-.55 1.2" />
    </Svg>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 2.25h7v3.5a3.5 3.5 0 0 1-7 0z" />
      <path d="M4.5 3.25H2.75v1a2 2 0 0 0 2 2M11.5 3.25h1.75v1a2 2 0 0 1-2 2" />
      <path d="M6.5 13.75h3M8 9.25v4.5" />
    </Svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.75 9.5 6.5 14.25 8 9.5 9.5 8 14.25 6.5 9.5 1.75 8 6.5 6.5z" />
    </Svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M12.9 9.75a1.1 1.1 0 0 0 .22 1.21l.04.04a1.33 1.33 0 1 1-1.88 1.88l-.04-.04a1.1 1.1 0 0 0-1.21-.22 1.1 1.1 0 0 0-.67 1v.11a1.33 1.33 0 1 1-2.66 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.21.22l-.04.04a1.33 1.33 0 1 1-1.88-1.88l.04-.04a1.1 1.1 0 0 0 .22-1.21 1.1 1.1 0 0 0-1-.67h-.11a1.33 1.33 0 1 1 0-2.66h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.22-1.21l-.04-.04a1.33 1.33 0 1 1 1.88-1.88l.04.04a1.1 1.1 0 0 0 1.21.22h.05a1.1 1.1 0 0 0 .67-1v-.11a1.33 1.33 0 0 1 2.66 0v.06a1.1 1.1 0 0 0 .67 1 1.1 1.1 0 0 0 1.21-.22l.04-.04a1.33 1.33 0 1 1 1.88 1.88l-.04.04a1.1 1.1 0 0 0-.22 1.21v.05a1.1 1.1 0 0 0 1 .67h.11a1.33 1.33 0 1 1 0 2.66h-.06a1.1 1.1 0 0 0-1 .67Z" />
    </Svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.25 3.25A1 1 0 0 1 3.25 2.25H6a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H3.25a1 1 0 0 1-1-1z" />
      <path d="M13.75 3.25a1 1 0 0 0-1-1H10a2 2 0 0 0-2 2v9a1.5 1.5 0 0 1 1.5-1.5h3.25a1 1 0 0 0 1-1z" />
    </Svg>
  );
}

export function BugIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="5.5" width="6" height="8" rx="3" />
      <path d="M5 8.5H2.5M13.5 8.5H11M5.2 11.5 3 12.75M12.8 11.5 15 12.75M5.2 6.25 3.25 4.75M10.8 6.25 12.75 4.75" />
      <path d="M6.25 5.25a1.75 1.75 0 0 1 3.5 0" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.25" y="3.5" width="11.5" height="10.25" rx="1.5" />
      <path d="M2.25 6.75h11.5M5.5 2.25v2.5M10.5 2.25v2.5" />
    </Svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.75 14.25 5 8 8.25 1.75 5z" />
      <path d="m1.75 8 6.25 3.25L14.25 8M1.75 11l6.25 3.25L14.25 11" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7.25" cy="7.25" r="4.75" />
      <path d="m11 11 3 3" />
    </Svg>
  );
}

/**
 * Judge marks.
 *
 * Deliberately not the sites' real logos — those are trademarks, and a Chrome
 * Web Store listing that ships them invites a takedown. These are neutral
 * glyphs in the judge's own accent colour.
 */
const PLATFORM_GLYPH: Record<string, { letter: string; color: string }> = {
  leetcode: { letter: 'LC', color: '#f89f1b' },
  codeforces: { letter: 'CF', color: '#4b8bf5' },
  atcoder: { letter: 'AC', color: '#b0b0b8' },
  codechef: { letter: 'CC', color: '#a97142' },
  hackerrank: { letter: 'HR', color: '#2ec866' },
  geeksforgeeks: { letter: 'GG', color: '#2f8d46' },
};

export function PlatformMark({ platform, size = 20 }: { platform: string; size?: number }) {
  const glyph = PLATFORM_GLYPH[platform] ?? { letter: '??', color: '#6b7280' };
  return (
    <span
      className="pmark"
      style={{
        width: size,
        height: size,
        color: glyph.color,
        // A tint of the judge's colour rather than the colour itself, so six of
        // them in a column do not fight each other.
        background: `color-mix(in srgb, ${glyph.color} 16%, transparent)`,
        fontSize: size * 0.42,
      }}
      aria-hidden="true"
    >
      {glyph.letter}
    </span>
  );
}
