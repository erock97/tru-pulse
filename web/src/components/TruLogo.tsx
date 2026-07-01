// The unified TRU mark: the animated "tru" ball (from the Coaching app) + the TRU
// wordmark (gold RU, from HQ). One lockup used across the suite. Colors inherit, so
// it reads on the dark sidebar and the light top bar alike.
export function TruLogo({ size = 30, wordSize = 20, sub }: { size?: number; wordSize?: number; sub?: string }) {
  return (
    <span className="tru-mark">
      <span className="tru-ball" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
        <span>tru</span>
      </span>
      <span className="tru-word" style={{ fontSize: wordSize }}>
        T<span className="r">RU</span>{sub ? <span className="sub">{sub}</span> : null}
      </span>
    </span>
  );
}
