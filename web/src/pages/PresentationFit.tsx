import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** A fixed 16:9 slide, fitted to the window independently of its content length. */
export function PresentationFit({ children, theme = '' }: { children: ReactNode; theme?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 1, contentScale: 1, height: 675 });
  useLayoutEffect(() => {
    const frame = viewport.current!, slide = content.current!;
    const measure = () => {
      const height = Math.max(slide.scrollHeight, slide.offsetHeight, 1);
      const scale = Math.min(frame.clientWidth / 1200, frame.clientHeight / 675);
      const contentScale = Math.min(1, 675 / height);
      setSize(previous => previous.scale === scale && previous.height === height ? previous : { scale, contentScale, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame); observer.observe(slide); measure();
    return () => observer.disconnect();
  }, []);
  return <div className="live-presentation-canvas" ref={viewport} tabIndex={0} role="region" aria-label="Presentation slide content">
    <div className="live-fit-bounds" style={{ width: 1200 * size.scale, height: 675 * size.scale }}>
      <div className={`live-slide-sheet ${theme}`} style={{ transform: `scale(${size.scale})` }}>
        <div className="live-fit-content" ref={content} style={{ width: 1200, top: (675 - size.height * size.contentScale) / 2, left: (1200 - 1200 * size.contentScale) / 2, transform: `scale(${size.contentScale})` }}>{children}</div>
      </div>
    </div>
  </div>;
}
