import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { TimerState, getElapsedMs, formatElapsed } from '@/lib/presentation-timer';
import { liveAudioLevel, type AudioLevelSample } from '@/lib/flow/audio-level';
import { PresentationScheduler } from '@/lib/presentation-scheduler';

export interface PresentationHUDProps {
  mode: string;
  status: string;
  isFollowing: boolean;
  audioLevelRef?: MutableRefObject<AudioLevelSample>;
  timerState: TimerState;
  onResetTimer: () => void;
}

function createWavyPath(R: number, A: number, F: number, P: number): string {
  let d = "";
  const points = 40;
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * Math.PI * 2;
    const r = R + A * Math.sin(F * theta + P);
    const x = 20 + r * Math.cos(theta); // Center at 20,20
    const y = 20 + r * Math.sin(theta);
    if (i === 0) d += `M ${x.toFixed(2)} ${y.toFixed(2)} `;
    else d += `L ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d + "Z";
}

export function PresentationHUD({
  mode,
  status,
  isFollowing,
  audioLevelRef,
  timerState,
  onResetTimer,
}: PresentationHUDProps) {
  const timeRef = useRef<HTMLSpanElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const pathsRef = useRef<(SVGPathElement | null)[]>([]);
  
  useEffect(() => {
    // Caches to avoid identical DOM writes
    let lastTimeText = '';
    let lastAriaVal = '';
    const lastD: (string | number)[] = [];
    const lastOpacity: string[] = [];
    
    let smoothedLevel = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0;
    
    // Preference listener
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = mediaQuery.matches;
    const updateMotionPref = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
    };
    mediaQuery.addEventListener('change', updateMotionPref);
    
    const scheduler = new PresentationScheduler((now, dt) => {
      if (document.hidden) {
        return { needsRAF: false, suspend: true };
      }
      
      let targetLevel = 0;
      if (mode === 'flow' && audioLevelRef?.current) {
        targetLevel = liveAudioLevel(audioLevelRef.current, now, status === 'listening');
      }
      
      smoothedLevel += (targetLevel - smoothedLevel) * 0.15;
      const displayLevel = smoothedLevel > 0.01 ? smoothedLevel : 0;
      
      const needsRAF = !prefersReducedMotion && displayLevel > 0;
      
      // 1. Timer Update
      const ms = getElapsedMs(timerState, now);
      const formattedTime = formatElapsed(ms);
      if (formattedTime !== lastTimeText && timeRef.current) {
        timeRef.current.textContent = formattedTime;
        lastTimeText = formattedTime;
      }
      
      // 2. ARIA Update
      const ariaVal = Math.round(displayLevel * 100).toString();
      if (ariaVal !== lastAriaVal && meterRef.current) {
        meterRef.current.setAttribute('aria-valuenow', ariaVal);
        lastAriaVal = ariaVal;
      }
      
      // 3. Visuals Update
      if (prefersReducedMotion) {
        // Static circles that indicate level via opacity only
        const baseRadii = [8, 12, 16];
        pathsRef.current.forEach((path, i) => {
          if (!path) return;
          const R = baseRadii[i];
          if (lastD[i] !== R) {
            path.setAttribute('d', createWavyPath(R, 0, 0, 0));
            lastD[i] = R;
          }
          if (displayLevel > (i * 0.2)) {
            const opacity = (0.3 + displayLevel * 0.5).toFixed(2);
            if (lastOpacity[i] !== opacity) {
              path.style.opacity = opacity;
              lastOpacity[i] = opacity;
            }
          } else {
            if (lastOpacity[i] !== '0') {
              path.style.opacity = '0';
              lastOpacity[i] = '0';
            }
          }
        });
      } else {
        if (displayLevel > 0) {
          // Wavy disrupted rings based on audio level
          phase1 += (0.03 + displayLevel * 0.05) * (dt / 16.6);
          phase2 -= (0.04 + displayLevel * 0.06) * (dt / 16.6);
          phase3 += (0.05 + displayLevel * 0.07) * (dt / 16.6);
          
          const phases = [phase1, phase2, phase3];
          const frequencies = [3, 5, 4];
          const baseRadii = [8, 12, 16];
          
          pathsRef.current.forEach((path, i) => {
            if (!path) return;
            const R = baseRadii[i];
            const A = displayLevel * (1.5 + i * 1.2); 
            const d = createWavyPath(R, A, frequencies[i], phases[i]);
            
            path.setAttribute('d', d); // changing every frame, no read-cache check needed
            lastD[i] = d;
            
            const baseOpacity = i === 0 ? 0.8 : (i === 1 ? 0.5 : 0.2);
            const opacity = (baseOpacity * (0.3 + displayLevel * 0.7)).toFixed(3);
            if (lastOpacity[i] !== opacity) {
              path.style.opacity = opacity;
              lastOpacity[i] = opacity;
            }
          });
        } else {
          // Settled to zero
          const baseRadii = [8, 12, 16];
          pathsRef.current.forEach((path, i) => {
            if (!path) return;
            const R = baseRadii[i];
            if (lastD[i] !== R) {
              path.setAttribute('d', createWavyPath(R, 0, 0, 0));
              lastD[i] = R;
            }
            if (lastOpacity[i] !== '0') {
              path.style.opacity = '0';
              lastOpacity[i] = '0';
            }
          });
        }
      }
      
      return { needsRAF, suspend: false };
    }, {
      requestAnimationFrame: requestAnimationFrame.bind(window),
      cancelAnimationFrame: cancelAnimationFrame.bind(window),
      setTimeout: setTimeout.bind(window),
      clearTimeout: clearTimeout.bind(window),
      now: performance.now.bind(performance)
    });
    
    const onVisibilityChange = () => {
      if (!document.hidden) {
        scheduler.onVisible();
      }
    };
    
    document.addEventListener('visibilitychange', onVisibilityChange);
    scheduler.start();
    
    return () => {
      scheduler.stop();
      mediaQuery.removeEventListener('change', updateMotionPref);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [mode, status, audioLevelRef, timerState]);

  // Determine state colours and labels
  let indicatorColor = 'bg-muted-foreground/40';
  let pulseClass = '';
  
  if (mode === 'manual') {
    indicatorColor = 'bg-muted-foreground/30';
  } else if (status === 'loading' || status === 'downloading') {
    indicatorColor = 'bg-yellow-500';
    pulseClass = 'animate-pulse';
  } else if (status === 'listening') {
    indicatorColor = isFollowing ? 'bg-green-500' : 'bg-primary';
  } else if (status === 'paused' || status === 'silence-stopped' || status === 'stopped') {
    indicatorColor = 'bg-muted-foreground/50';
  } else if (status === 'error') {
    indicatorColor = 'bg-destructive';
  }

  let statusText = 'Mic Off';
  if (mode === 'flow') {
    if (status === 'loading' || status === 'downloading') statusText = 'Preparing';
    else if (status === 'listening') statusText = isFollowing ? 'Recognising' : 'Listening';
    else if (status === 'paused') statusText = 'Paused';
    else if (status === 'silence-stopped' || status === 'stopped') statusText = 'Stopped';
    else if (status === 'error') statusText = 'Error';
    else statusText = 'Mic Off'; // Covers unsupported, needs-model, ready states
  }

  return (
    <div className="absolute top-20 right-6 z-40 flex flex-col items-end gap-3 pointer-events-none transition-all duration-300">
      
      {/* Timer HUD */}
      <div className="flex items-center gap-2 bg-background/70 backdrop-blur-xl px-3 py-1.5 rounded-full border border-border/50 shadow-sm pointer-events-auto select-none">
        <span 
          role="timer"
          aria-live="off"
          aria-label="Presentation elapsed time"
          ref={timeRef} 
          className="tabular-nums min-w-[5ch] text-center font-medium font-mono text-sm text-foreground"
        >
          00:00
        </span>
        <div className="w-px h-3 bg-border mx-0.5" />
        <button 
          onClick={onResetTimer}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.stopPropagation();
            }
          }}
          className="w-8 h-8 p-1.5 flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title="Reset Timer"
          aria-label="Reset Timer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
      </div>

      {/* Mic Visualizer HUD */}
      <div className="flex items-center gap-2 bg-background/70 backdrop-blur-xl px-3 py-1.5 rounded-full border border-border/50 shadow-sm pointer-events-auto select-none">
        <div 
          ref={meterRef}
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          className="relative w-8 h-8 flex items-center justify-center overflow-visible"
        >
          <svg viewBox="0 0 40 40" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 overflow-visible">
            {[0, 1, 2].map(i => (
              <path 
                key={i}
                ref={el => { pathsRef.current[i] = el; }} 
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5 - (i * 0.3)}
                className={`${isFollowing ? 'text-green-500' : 'text-primary'} transition-colors duration-300`}
                style={{ opacity: 0 }}
              />
            ))}
          </svg>
          <div className={`relative z-10 w-2 h-2 rounded-full transition-colors duration-300 ${indicatorColor} ${pulseClass}`} />
        </div>
        <span className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground min-w-[11ch] text-left ml-1">
          {statusText}
        </span>
      </div>
      
    </div>
  );
}
