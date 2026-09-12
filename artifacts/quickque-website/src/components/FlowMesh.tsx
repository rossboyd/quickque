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
      const project = (u: number, v: number) => {
        const wave = Math.sin(u * 4.8 + time * .32) * .16 + Math.cos(v * 3.6 - time * .2) * .1;
        const twist = v * .65 + time * .055;
        const x = u * Math.cos(twist) - wave * Math.sin(twist);
        const y = wave * Math.cos(twist) + u * Math.sin(twist);
        return [width * .5 + x * width * .51 + v * width * .13 + pointerX * 22,
          height * .52 + y * height * .8 + v * height * .31 + pointerY * 14 + scroll * .08];
      };
      const lines = width < 600 ? 28 : 46;
      for (let axis = 0; axis < 2; axis++) {
        for (let i = 0; i <= lines; i++) {
          const fixed = i / lines * 2 - 1;
          const opacity = .12 + .42 * Math.pow(Math.sin(i / lines * Math.PI), .6);
          ctx.strokeStyle = `rgba(${axis ? '154,168,255' : '109,128,220'},${opacity})`;
          ctx.lineWidth = .65;
          ctx.beginPath();
          for (let j = 0; j <= 64; j++) {
            const moving = j / 64 * 2 - 1;
            const [x, y] = project(axis ? fixed : moving, axis ? moving : fixed);
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
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
