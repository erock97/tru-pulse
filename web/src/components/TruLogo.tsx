// The unified TRU lockup: the Trinity emblem + the TRU wordmark (gold RU).
// The emblem replaced the old animated "tru" ball on 2026-08-23, when the brand
// got its first real mark — the Tripod: three machined bars, each carrying the
// other two, one for each of Pulse, Coach and Rep. Same asset the landing
// page's arrival sequence orbits, so inside and outside finally wear one mark.
export function TruLogo({ size = 30, wordSize = 20, sub }: { size?: number; wordSize?: number; sub?: string }) {
  return (
    <span className="tru-mark">
      <img
        className="tru-emblem"
        src="/tru-mark.png"
        alt=""
        width={size}
        height={size}
        decoding="async"
        style={{ width: size, height: size }}
      />
      <span className="tru-word" style={{ fontSize: wordSize }}>
        T<span className="r">RU</span>{sub ? <span className="sub">{sub}</span> : null}
      </span>
    </span>
  );
}
