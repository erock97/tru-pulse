import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Fit the whole composed slide, including native demos, without clipping it. */
export function PresentationFit({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 1, height: 0, width: 1200 });
  useLayoutEffect(() => {
    const frame = viewport.current!, slide = content.current!;
    const measure = () => {
      const width = 1200;
      const height = Math.max(slide.scrollHeight, slide.offsetHeight, 1);
      const scale = Math.min(frame.clientWidth / width, frame.clientHeight / height, 1.6);
      setSize(previous => previous.scale === scale && previous.height === height ? previous : { scale, height, width });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(slide);
    measure();
    return () => observer.disconnect();
  }, []);
  return <div className="live-presentation-canvas" ref={viewport} tabIndex={0} role="region" aria-label="Presentation slide content">
    <div className="live-fit-bounds" style={{ width: size.width * size.scale, height: size.height * size.scale }}>
      <div className="live-fit-content" ref={content} style={{ width: size.width, transform: `scale(${size.scale})` }}>{children}</div>
    </div>
  </div>;
}
