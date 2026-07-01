import { useEffect, useRef, useState } from 'react';

/** Animate a number from 0 → target (easeOutCubic) on mount / when target changes. */
export function useCountUp(target: number, dur = 1100): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const step = (t: number) => {
      if (start === null) start = t;
      const p = Math.min((t - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setV(target * e);
      if (p < 1) raf = requestAnimationFrame(step);
      else setV(target);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

export function CountUp({ value, fmt }: { value: number; fmt?: (n: number) => string }) {
  const v = useCountUp(value);
  return <>{fmt ? fmt(v) : String(Math.round(v))}</>;
}

/** Worked-% progress ring that sweeps in. */
export function Ring({ pct }: { pct: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const len = (pct / 100) * c;
  const arc = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const el = arc.current;
    if (!el) return;
    el.style.strokeDashoffset = String(len);
    const id = requestAnimationFrame(() => {
      el.style.strokeDashoffset = '0';
    });
    return () => cancelAnimationFrame(id);
  }, [len]);
  return (
    <svg width="128" height="128" viewBox="0 0 128 128">
      <circle cx="64" cy="64" r={r} fill="none" stroke="#ece2d2" strokeWidth="13" />
      <circle
        ref={arc}
        cx="64"
        cy="64"
        r={r}
        fill="none"
        stroke="#2e8b57"
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray={`${len} ${c - len}`}
        strokeDashoffset={len}
        transform="rotate(-90 64 64)"
        style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)' }}
      />
      <text x="64" y="62" textAnchor="middle" fontSize="30" fontWeight="800" fill="#33281a" fontFamily="Georgia">
        <CountUp value={pct} fmt={(n) => `${Math.round(n)}%`} />
      </text>
      <text x="64" y="80" textAnchor="middle" fontSize="9" fill="#8a7a63" letterSpacing="1.2">WORKED</text>
    </svg>
  );
}

/** Source-mix donut that scales in. */
export function Donut({ sources }: { sources: Array<{ name: string; n: number; c: string }> }) {
  const total = sources.reduce((s, x) => s + x.n, 0) || 1;
  const r = 54;
  const c = 2 * Math.PI * r;
  const g = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = g.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.style.transform = 'scale(1)';
      el.style.opacity = '1';
    });
    return () => cancelAnimationFrame(id);
  }, [total]);
  let off = 0;
  const segs = sources.map((s, i) => {
    const len = (s.n / total) * c;
    const el = (
      <circle
        key={i}
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke={s.c}
        strokeWidth="20"
        strokeDasharray={`${len} ${c - len}`}
        strokeDashoffset={-off}
        transform="rotate(-90 70 70)"
      />
    );
    off += len;
    return el;
  });
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <g
        ref={g}
        style={{
          transformBox: 'fill-box',
          transformOrigin: 'center',
          transform: 'scale(.6)',
          opacity: 0,
          transition: 'transform .7s cubic-bezier(.22,1,.36,1), opacity .5s ease',
        }}
      >
        {segs}
      </g>
      <text x="70" y="66" textAnchor="middle" fontSize="24" fontWeight="800" fill="#33281a" fontFamily="Georgia">
        <CountUp value={total} />
      </text>
      <text x="70" y="84" textAnchor="middle" fontSize="9.5" fill="#8a7a63" letterSpacing="1.2">PAID LEADS</text>
    </svg>
  );
}

export const SOURCE_COLORS: Record<string, string> = {
  'Zillow': '#a9791f',
  'Realtor.com': '#c0492f',
  'Homes.com': '#2e8b57',
  'Facebook': '#2f6bb0',
  'Google': '#d99a2b',
  'Referrals': '#7d6a8a',
  'Other': '#8a7a63',
};
