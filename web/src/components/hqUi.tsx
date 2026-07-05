/** Avatar with initials — dark-scoped. */
export function Avatar({ name, size = 44, tone = 0 }: { name: string; size?: number; tone?: number }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const tones = [
    'linear-gradient(135deg,#c9962f,#a9791f)',
    'linear-gradient(135deg,#4a7c6f,#33281a)',
    'linear-gradient(135deg,#c06b4f,#33281a)',
    'linear-gradient(135deg,#7a6a4a,#33281a)',
    'linear-gradient(135deg,#a9791f,#33281a)',
  ];
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.36, background: tones[tone % tones.length] }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Confidence / score ring (SVG, draws in). */
export function Ring({
  pct,
  size = 60,
  stroke = 6,
  label,
  color = 'var(--accent)',
}: {
  pct: number;
  size?: number;
  stroke?: number;
  label?: string;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track-fill)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1.1s var(--ease)' }}
        />
      </svg>
      <span className="ring-label">{label ?? `${pct}`}</span>
    </div>
  );
}

/** Inline stroke icons (no external deps). */
export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
        </svg>
      );
    case 'pulse':
      return (
        <svg {...common}>
          <path d="M3 12h4l2-6 4 12 2-6h6" />
        </svg>
      );
    case 'coach':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M15 15c3 0 6 1.5 6 5" />
        </svg>
      );
    case 'rep':
      return (
        <svg {...common}>
          <circle cx="12" cy="9" r="4" />
          <path d="M8 13l-1 8 5-3 5 3-1-8" />
        </svg>
      );
    case 'prospect':
      return (
        <svg {...common}>
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
        </svg>
      );
    case 'studio':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <circle cx="12" cy="12" r="3.4" />
          <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 2l8 3v6c0 5-3.5 8-8 11-4.5-3-8-6-8-11V5z" />
        </svg>
      );
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}
