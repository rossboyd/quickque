import { useEffect, useRef } from 'react';

/** Decorative, locally rendered dot field. No WebGL or external assets. */
export function FlowMesh({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldSeed = useRef(Math.random() * Math.PI * 2);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, frame = 0, last = 0, time = 0;
    let visible = true;
    const spacing = 19; // Around 87% more dots than the previous 26px grid.
    const seed = fieldSeed.current;
    let dots: { x: number; y: number; u: number; v: number; variation: number }[] = [];
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      // Advect the whole irregular field rightward; every wave shares this
      // coordinate so overlapping pulses cannot suggest a reverse direction.
      const travel = time * .075;
      for (const { x, y, u, v, variation } of dots) {
        const flow = u - travel;
        const bend = Math.sin(v * 8.3 + seed) * .15 + Math.sin(v * 17.1 - seed) * .045;
        const field = (
          Math.sin((flow * 2.1 + bend) * Math.PI * 2 + seed) * .48 +
          Math.sin((flow * 3.7 + v * .55) * Math.PI * 2 - seed) * .30 +
          Math.cos((flow * 6.3 - v * 1.2 + bend) * Math.PI * 2 + seed * 2) * .16
        );
        const intensity = Math.max(0, Math.min(1, (field + .94) / 1.88));
        const radius = (.8 + intensity * 3.3) * variation;
        ctx.fillStyle = "rgba(255, 83, 73, " + (.13 + intensity * .65) + ")";
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
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
      dots = [];
      for (let y = spacing * .5; y < height; y += spacing) {
        for (let x = spacing * .5; x < width; x += spacing) {
          // Stable per-dot variation: randomness never flickers between frames.
          const noise = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
          dots.push({ x, y, u: x / Math.max(width, 1), v: y / Math.max(height, 1), variation: .8 + (noise - Math.floor(noise)) * .4 });
        }
      }
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    intersection.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    resize(); sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync);
    };
  }, [paused]);

  return <canvas ref={canvasRef} className="flow-mesh" aria-hidden="true" />;
}
