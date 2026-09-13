import { useEffect, useRef } from 'react';

/** Decorative, locally rendered wire surface. No WebGL or external assets. */
export function FlowMesh({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(pointer: fine)');
    let width = 0, height = 0, frame = 0, last = 0, time = 0;
    let visible = true;
    let pointerX = 0, pointerY = 0, scroll = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const spacing = 26;
      // Periodic, directional pulses keep dot centres fixed and loop seamlessly.
      const phase = time / 8 * Math.PI * 2;
      for (let y = spacing * .5; y < height; y += spacing) {
        for (let x = spacing * .5; x < width; x += spacing) {
          const u = x / Math.max(width, 1), v = y / Math.max(height, 1);
          const field = (
            Math.sin((u * .65 + v * 4.8) * Math.PI * 2 - phase * 3) * .42 +
            Math.sin((u * 2.8 - v * .35) * Math.PI * 2 + phase * 5) * .28 +
            Math.cos((u * 1.4 + v * 2.2) * Math.PI * 2 - phase * 2) * .2
          );
          const intensity = Math.max(0, Math.min(1, (field + .94) / 1.88));
          const radius = 1 + intensity * 4;
          ctx.fillStyle = "rgba(255, 83, 73, " + (.16 + intensity * .68) + ")";
          ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        }
      }
    };
    const animate = (now: number) => {
      frame = 0;
      if (!visible || document.hidden || paused || reduced.matches) return;
      if (now - last >= 1000 / 30) {
        time += Math.min((now - last) / 1000, .05);
        last = now;
        draw();
      }
      frame = requestAnimationFrame(animate);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      draw();
      if (visible && !document.hidden && !paused && !reduced.matches) {
        last = performance.now();
        frame = requestAnimationFrame(animate);
      }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    };
    const move = (event: PointerEvent) => {
      if (paused || reduced.matches || !finePointer.matches || !visible) return;
      const rect = canvas.getBoundingClientRect();
      pointerX = (event.clientX - rect.left) / rect.width - .5;
      pointerY = (event.clientY - rect.top) / rect.height - .5;
    };
    const onScroll = () => {
      if (!paused && !reduced.matches && visible) scroll = Math.min(window.scrollY, 900);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    intersection.observe(canvas);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    resize(); sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect(); intersection.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync);
    };
  }, [paused]);

  return <canvas ref={canvasRef} className="flow-mesh" aria-hidden="true" />;
}
