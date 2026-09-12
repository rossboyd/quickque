import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresentationScheduler } from './presentation-scheduler.ts';

test('Presentation Scheduler', async (t) => {
  let currentTime = 1000;
  
  let rafCallback: ((time: number) => void) | null = null;
  let rafIdCounter = 1;
  let cancelledRaf: number[] = [];
  
  let timeoutCallback: (() => void) | null = null;
  let timeoutIdCounter = 1;
  let cancelledTimeout: number[] = [];

  const globals = {
    requestAnimationFrame: (cb: (time: number) => void) => {
      rafCallback = cb;
      return rafIdCounter++;
    },
    cancelAnimationFrame: (id: number) => {
      cancelledRaf.push(id);
      rafCallback = null;
    },
    setTimeout: (cb: () => void, ms: number) => {
      timeoutCallback = cb;
      return timeoutIdCounter++;
    },
    clearTimeout: (id: number) => {
      cancelledTimeout.push(id);
      timeoutCallback = null;
    },
    now: () => currentTime,
  };

  const resetMocks = () => {
    rafCallback = null;
    timeoutCallback = null;
    cancelledRaf = [];
    cancelledTimeout = [];
  };

  await t.test('schedules RAF when active', () => {
    resetMocks();
    let tickCount = 0;
    const scheduler = new PresentationScheduler(() => {
      tickCount++;
      return { needsRAF: true, suspend: false };
    }, globals);

    scheduler.start();
    assert.equal(tickCount, 1);
    assert.ok(rafCallback !== null);
    assert.equal(timeoutCallback, null);
    
    // Fire RAF
    const cb = rafCallback;
    rafCallback = null;
    currentTime += 16;
    cb!(currentTime);
    
    assert.equal(tickCount, 2);
    assert.ok(rafCallback !== null);
    
    scheduler.stop();
    assert.equal(rafCallback, null);
  });

  await t.test('schedules setTimeout when idle', () => {
    resetMocks();
    let tickCount = 0;
    const scheduler = new PresentationScheduler(() => {
      tickCount++;
      return { needsRAF: false, suspend: false };
    }, globals);

    scheduler.start();
    assert.equal(tickCount, 1);
    assert.equal(rafCallback, null);
    assert.ok(timeoutCallback !== null);

    // Fire Timeout
    const cb = timeoutCallback;
    timeoutCallback = null;
    currentTime += 100;
    cb!();

    assert.equal(tickCount, 2);
    assert.ok(timeoutCallback !== null);
    
    scheduler.stop();
  });

  await t.test('suspends and recovers correctly via onVisible', () => {
    resetMocks();
    let suspend = false;
    let tickCount = 0;
    
    const scheduler = new PresentationScheduler(() => {
      tickCount++;
      return { needsRAF: false, suspend };
    }, globals);

    scheduler.start();
    assert.equal(tickCount, 1);
    assert.ok(timeoutCallback !== null);
    
    // Simulate hidden
    suspend = true;
    const cb = timeoutCallback;
    timeoutCallback = null;
    cb!();
    
    assert.equal(tickCount, 2);
    // Suspended, so it should not schedule another timeout or RAF
    assert.equal(timeoutCallback, null);
    assert.equal(rafCallback, null);
    
    // Simulate visible recovery
    suspend = false;
    scheduler.onVisible();
    
    assert.equal(tickCount, 3);
    assert.ok(timeoutCallback !== null); // Resumed successfully
    
    scheduler.stop();
  });

  await t.test('clears handles unconditionally on visibility change', () => {
    resetMocks();
    let tickCount = 0;
    const scheduler = new PresentationScheduler(() => {
      tickCount++;
      return { needsRAF: false, suspend: false };
    }, globals);

    scheduler.start();
    assert.equal(tickCount, 1);
    const firstTimeout = timeoutIdCounter - 1;
    assert.ok(timeoutCallback !== null);
    
    // Force visibility change while timeout is pending
    scheduler.onVisible();
    
    assert.equal(tickCount, 2);
    assert.ok(cancelledTimeout.includes(firstTimeout)); // Should have cancelled the pending timeout
    
    scheduler.stop();
  });

  await t.test('guards late callbacks', () => {
    resetMocks();
    let tickCount = 0;
    const scheduler = new PresentationScheduler(() => {
      tickCount++;
      return { needsRAF: false, suspend: false };
    }, globals);

    scheduler.start();
    const cb = timeoutCallback;
    
    scheduler.stop(); // This cancels handles and sets isRunning = false
    
    // Simulate late callback firing (e.g., if JS event loop was weird)
    if (cb) cb();
    
    // Tick count should remain 1 (only the initial start tick)
    assert.equal(tickCount, 1);
  });
});
