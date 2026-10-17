import { useEffect, useRef, useState } from 'react';

/** Wrap at word boundaries; condense only when one word exceeds its column. */
export default function CategoryTitle({ title }: { title: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    let active = true;
    const fit = () => {
      const available = container.getBoundingClientRect().width;
      const naturalWidth = parseFloat(getComputedStyle(text).width);
      if (active && available && naturalWidth) {
        setScale(Math.min(1, available / naturalWidth));
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    observer.observe(text);
    fit();
    void document.fonts.ready.then(fit);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [title]);

  return (
    <span className="category-title-fit" ref={containerRef}>
      <span className="category-title-text" ref={textRef} style={{ transform: `scaleX(${scale})` }}>
        {title}
      </span>
    </span>
  );
}
