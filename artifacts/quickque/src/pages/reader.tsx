import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { useLocation, useParams } from 'wouter';
import { 
  Play, Pause, X, Minus, Plus, Settings2, Maximize2, Minimize2, ChevronLeft, ChevronRight, Droplets 
} from 'lucide-react';
import { isDesktop, setOverlayMode, setAlwaysOnTop, startDragging } from '@/lib/desktop';

export default function Reader() {
  const { scripts, settings, updateSettings } = useStore();
  const params = useParams();
  const [_, setLocation] = useLocation();
  const script = scripts.find(s => s.id === params.id);

  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [showControls, setShowControls] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const textContentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  
  const lastTimeRef = useRef<number>(0);
  const reqRef = useRef<number>(0);

  const [desktopError, setDesktopError] = useState<string | null>(null);

  useEffect(() => {
    const initDesktop = async () => {
      try {
        if (isDesktop()) {
          await setAlwaysOnTop(true);
          if (settings.compactMode) {
            document.documentElement.classList.add('is-overlay');
            await setOverlayMode(true);
          }
        } else if (settings.compactMode) {
          document.documentElement.classList.add('is-overlay');
        }
      } catch (err: any) {
        setDesktopError(`Failed to set always on top: ${err.message || String(err)}`);
      }
    };
    initDesktop();
    
    return () => {
      // Synchronous cleanup can't await reliably on unmount, but we try-catch best effort
      try {
        if (isDesktop()) {
          setAlwaysOnTop(false).catch(console.error);
          setOverlayMode(false).catch(console.error);
        }
      } catch (e) {}
      document.documentElement.classList.remove('is-overlay');
    };
  }, [settings.compactMode]);

  const toggleCompactMode = useCallback(async () => {
    const newMode = !settings.compactMode;
    updateSettings({ compactMode: newMode });
    
    try {
      if (newMode) {
        document.documentElement.classList.add('is-overlay');
        if (isDesktop()) {
          await setOverlayMode(true);
        }
      } else {
        document.documentElement.classList.remove('is-overlay');
        if (isDesktop()) {
          await setOverlayMode(false);
        }
      }
    } catch (err: any) {
      setDesktopError(`Failed to toggle overlay mode: ${err.message || String(err)}`);
      // Revert UI state if native call fails
      updateSettings({ compactMode: !newMode });
      if (!newMode) {
        document.documentElement.classList.add('is-overlay');
      } else {
        document.documentElement.classList.remove('is-overlay');
      }
    }
  }, [settings.compactMode, updateSettings]);

  const exitReader = useCallback(async () => {
    setIsPlaying(false);
    try {
      if (isDesktop()) {
        await setAlwaysOnTop(false);
        await setOverlayMode(false);
      }
    } catch (err: any) {
      setDesktopError(`Failed to exit overlay: ${err.message || String(err)}`);
      // Proceed to exit anyway after short delay if it fails
    }
    document.documentElement.classList.remove('is-overlay');
    setLocation('/');
  }, [setLocation]);

  const exactScrollTopRef = useRef<number>(0);

  // Scrolling logic
  useEffect(() => {
    if (!isPlaying) {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      return;
    }

    // Sync ref with actual DOM to allow resuming accurately after manual scroll
    if (containerRef.current) {
      exactScrollTopRef.current = containerRef.current.scrollTop;
    }

    const scrollLoop = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      // Cap delta time to 50ms to prevent massive jumps after backgrounding
      const deltaTime = Math.min(time - lastTimeRef.current, 50);
      lastTimeRef.current = time;

      if (containerRef.current && textContentRef.current) {
        // speed mapping: 50 -> approx 30px per sec depending on font
        const pxPerSecond = (settings.speed / 50) * (settings.fontSize * 1.5);
        const pxPerFrame = (pxPerSecond * deltaTime) / 1000;
        
        const maxScroll = containerRef.current.scrollHeight - containerRef.current.clientHeight;
        if (containerRef.current.scrollTop < maxScroll) {
          exactScrollTopRef.current += pxPerFrame;
          containerRef.current.scrollTop = exactScrollTopRef.current;
        } else {
          setIsPlaying(false); // reached end
        }
      }
      reqRef.current = requestAnimationFrame(scrollLoop);
    };

    reqRef.current = requestAnimationFrame(scrollLoop);
    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      lastTimeRef.current = 0;
    };
  }, [isPlaying, settings.speed, settings.fontSize]);

  // Section tracking during scroll
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      
      const scrollY = containerRef.current.scrollTop;
      const viewportMid = scrollY + containerRef.current.clientHeight / 3; // read marker is at 1/3

      let currentIdx = 0;
      for (let i = 0; i < sectionRefs.current.length; i++) {
        const el = sectionRefs.current[i];
        if (el) {
          // If the element's top is above the viewport mid, it's the current one
          if (el.offsetTop <= viewportMid) {
            currentIdx = i;
          }
        }
      }
      
      if (currentIdx !== activeSectionIdx) {
        setActiveSectionIdx(currentIdx);
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
    return undefined;
  }, [activeSectionIdx]);

  const jumpToSection = useCallback((idx: number) => {
    if (!script) return;
    if (idx < 0 || idx >= script.sections.length) return;
    
    const el = sectionRefs.current[idx];
    if (el && containerRef.current) {
      // scroll to place the section exactly at the resume marker (30% down)
      const offset = el.offsetTop - (containerRef.current.clientHeight * 0.3);
      const targetTop = offset > 0 ? offset : 0;
      exactScrollTopRef.current = targetTop;
      containerRef.current.scrollTo({ top: targetTop, behavior: 'auto' });
      setActiveSectionIdx(idx);
    }
  }, [script]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement || 
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement).isContentEditable
      ) return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(p => !p);
      } else if (e.code === 'Escape') {
        e.preventDefault();
        exitReader();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        jumpToSection(activeSectionIdx + 1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        jumpToSection(activeSectionIdx - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSectionIdx, exitReader, jumpToSection]);

  // External Native Controls
  useEffect(() => {
    const handleNativeControl = (e: any) => {
      const detail = e.detail;
      if (detail === 'toggle') {
        setIsPlaying(p => !p);
      } else if (detail === 'next') {
        jumpToSection(activeSectionIdx + 1);
      } else if (detail === 'previous') {
        jumpToSection(activeSectionIdx - 1);
      }
    };
    
    window.addEventListener('quickque:control', handleNativeControl);
    return () => window.removeEventListener('quickque:control', handleNativeControl);
  }, [activeSectionIdx, jumpToSection]);

  // Auto-hide controls
  useEffect(() => {
    let timeout: number;
    const resetHide = () => {
      setShowControls(true);
      clearTimeout(timeout);
      if (isPlaying) {
        timeout = window.setTimeout(() => setShowControls(false), 3000);
      }
    };
    
    window.addEventListener('mousemove', resetHide);
    if (isPlaying) {
      resetHide();
    } else {
      setShowControls(true);
    }
    
    return () => {
      window.removeEventListener('mousemove', resetHide);
      clearTimeout(timeout);
    };
  }, [isPlaying]);

  if (!script) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-4 text-center">
        <h2 className="text-2xl font-semibold mb-2">Script not found</h2>
        <p className="text-muted-foreground mb-8">The script you are trying to read doesn't exist.</p>
        <button 
          onClick={exitReader} 
          className="px-6 py-3 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  const bgOpacity = settings.compactMode ? (settings.backgroundOpacity / 100) : 1;
  const overlayClass = settings.compactMode ? 'fixed inset-0 m-2 rounded-xl border shadow-2xl overflow-hidden backdrop-blur-sm' : 'h-[100dvh] w-full';

  return (
    <div 
      className={`flex flex-col transition-all duration-300 ${overlayClass}`}
      style={{
        backgroundColor: `hsl(var(--background) / ${bgOpacity})`,
        borderColor: settings.compactMode ? `hsl(var(--border) / 0.5)` : 'transparent',
      }}
    >
      {/* Title Bar (Draggable in compact mode) */}
      <div 
        className={`flex flex-col z-50 transition-opacity duration-300 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}
        onMouseDown={async (e) => {
          if (settings.compactMode && !(e.target as HTMLElement).closest('button, input')) {
            try {
              if (isDesktop()) {
                await startDragging();
              }
            } catch (err: any) {
              setDesktopError(`Drag failed: ${err.message || String(err)}`);
            }
          }
        }}
      >
        {desktopError && (
          <div className="bg-destructive/90 text-destructive-foreground text-xs px-3 py-1.5 flex justify-between items-center backdrop-blur-md">
            <span>{desktopError}</span>
            <button onClick={() => setDesktopError(null)}>Dismiss</button>
          </div>
        )}
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-4">
          <button 
            onClick={exitReader}
            className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors backdrop-blur-md"
            title="Exit (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-1">
            <button 
              onClick={toggleCompactMode}
              className={`p-2 rounded-full transition-colors backdrop-blur-md ${settings.compactMode ? 'bg-primary text-primary-foreground' : 'hover:bg-black/10 dark:hover:bg-white/10'}`}
              title="Toggle Compact Overlay"
            >
              {settings.compactMode ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-background/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-border/50 overflow-hidden text-sm max-w-full">
          <div className="flex items-center gap-1">
            <button 
              onClick={() => updateSettings({ fontSize: Math.max(16, settings.fontSize - 4) })}
              className="p-1 hover:text-primary transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="font-mono min-w-[3ch] text-center text-xs">{settings.fontSize}</span>
            <button 
              onClick={() => updateSettings({ fontSize: Math.min(120, settings.fontSize + 4) })}
              className="p-1 hover:text-primary transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          
          <div className="w-px h-4 bg-border mx-1" />
          
          <div className="flex items-center gap-1.5 flex-1 min-w-[60px]">
            <Settings2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <input 
              type="range" 
              min="10" 
              max="150" 
              value={settings.speed}
              title="Scroll Speed"
              onChange={e => updateSettings({ speed: parseInt(e.target.value) })}
              className="w-12 md:w-20 accent-primary"
            />
          </div>

          <div className="w-px h-4 bg-border mx-1" />

          <div className="flex items-center gap-1.5 flex-1 min-w-[60px]">
            <Droplets className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <input 
              type="range" 
              min="0" 
              max="100" 
              value={settings.backgroundOpacity}
              title="Background Opacity"
              onChange={e => updateSettings({ backgroundOpacity: parseInt(e.target.value) })}
              className="w-12 md:w-20 accent-primary"
            />
          </div>
        </div>
        </div>
      </div>

      {/* Reader Content Area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Read Marker (Resume here marker) */}
        <div className="absolute left-0 right-0 top-[30%] h-[2px] bg-gradient-to-r from-primary/80 via-primary/20 to-transparent z-30 pointer-events-none flex items-center">
          <div className="w-3 h-3 bg-primary rounded-full ml-4 shadow-[0_0_10px_rgba(var(--primary),0.8)]" />
          {!isPlaying && (
            <div className="ml-3 px-2 py-0.5 rounded text-xs font-bold bg-primary text-primary-foreground shadow-sm uppercase tracking-wider animate-in fade-in zoom-in duration-200">
              Paused - Space to resume
            </div>
          )}
        </div>

        {/* Scrollable Container */}
        <div 
          ref={containerRef}
          className="absolute inset-0 overflow-y-auto px-6 md:px-24 pb-[80vh]"
          style={{ 
            paddingTop: '30vh',
            fontFamily: 'var(--font-sans)',
            fontSize: `${settings.fontSize}px`,
            lineHeight: 1.5
          }}
        >
          <div ref={textContentRef} className="max-w-4xl mx-auto space-y-[10vh]">
            {script.sections.map((section, idx) => (
              <div 
                key={section.id} 
                ref={el => { sectionRefs.current[idx] = el; }}
                className={`transition-opacity duration-500 ${activeSectionIdx === idx ? 'opacity-100' : 'opacity-30'}`}
              >
                {script.sections.length > 1 && (
                  <h3 
                    className="font-bold text-primary mb-6 flex items-center gap-4"
                    style={{ fontSize: `${settings.fontSize * 0.75}px` }}
                  >
                    <span className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-mono tracking-tighter">
                      {idx + 1}
                    </span>
                    {section.title}
                  </h3>
                )}
                <div 
                  className="whitespace-pre-wrap font-medium tracking-tight text-foreground"
                >
                  {section.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Controls / Section Navigation */}
      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 md:gap-4 p-2 md:p-3 rounded-full bg-background/80 backdrop-blur-xl border border-border shadow-2xl z-50 transition-all duration-300 ${showControls || !isPlaying ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
        
        <button
          onClick={() => jumpToSection(activeSectionIdx - 1)}
          disabled={activeSectionIdx === 0}
          className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
          title="Previous Section (Left Arrow)"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <select
          value={activeSectionIdx}
          onChange={(e) => jumpToSection(Number(e.target.value))}
          className="bg-transparent font-medium text-foreground appearance-none outline-none text-center text-sm px-2 w-32 md:w-48 truncate cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded"
        >
          {script.sections.map((sec, idx) => (
            <option key={sec.id} value={idx}>
              {idx + 1}. {sec.title || 'Untitled'}
            </option>
          ))}
        </select>

        <button
          onClick={() => jumpToSection(activeSectionIdx + 1)}
          disabled={activeSectionIdx === script.sections.length - 1}
          className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
          title="Next Section (Right Arrow)"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        
        <div className="w-px h-6 bg-border mx-1" />
        
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="w-14 h-14 flex items-center justify-center bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 hover:scale-105 transition-all focus:outline-none focus:ring-4 focus:ring-primary/30"
        >
          {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
        </button>
      </div>

    </div>
  );
}
