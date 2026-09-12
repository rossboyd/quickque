export interface SchedulerGlobals {
  requestAnimationFrame: (cb: (time: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  now: () => number;
}

export type TickCallback = (now: number, dt: number) => { needsRAF: boolean; suspend: boolean };

export class PresentationScheduler {
  private reqRAF: number | null = null;
  private reqTimeout: number | null = null;
  private isRunning = false;
  private lastTick = 0;
  private readonly onTick: TickCallback;
  private readonly globals: SchedulerGlobals;

  constructor(
    onTick: TickCallback,
    globals: SchedulerGlobals
  ) {
    this.onTick = onTick;
    this.globals = globals;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTick = this.globals.now();
    this.loop();
  }

  stop() {
    this.isRunning = false;
    this.clearHandles();
  }

  onVisible() {
    if (!this.isRunning) return;
    this.clearHandles();
    this.lastTick = this.globals.now();
    this.loop();
  }

  private loop = () => {
    // Guard late callbacks: always clear handles at the top
    this.clearHandles();
    
    if (!this.isRunning) return;
    
    const now = this.globals.now();
    const dt = Math.max(0, Math.min(now - this.lastTick, 50));
    this.lastTick = now;
    
    const { needsRAF, suspend } = this.onTick(now, dt);
    
    if (suspend) {
      return;
    }
    
    if (needsRAF) {
      this.reqRAF = this.globals.requestAnimationFrame(this.loop);
    } else {
      this.reqTimeout = this.globals.setTimeout(this.loop, 100);
    }
  };

  private clearHandles() {
    if (this.reqRAF !== null) {
      this.globals.cancelAnimationFrame(this.reqRAF);
      this.reqRAF = null;
    }
    if (this.reqTimeout !== null) {
      this.globals.clearTimeout(this.reqTimeout);
      this.reqTimeout = null;
    }
  }
}
