import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 
  createTimer, 
  startTimer, 
  pauseTimer, 
  resetTimer, 
  getElapsedMs, 
  formatElapsed 
} from './presentation-timer.ts';

test('Presentation Timer', async (t) => {
  await t.test('starts from 0', () => {
    const timer = createTimer();
    assert.equal(getElapsedMs(timer, 100), 0);
  });

  await t.test('accumulates time when started', () => {
    let timer = createTimer();
    timer = startTimer(timer, 1000);
    assert.equal(getElapsedMs(timer, 1500), 500);
    assert.equal(getElapsedMs(timer, 2000), 1000);
  });

  await t.test('pauses and retains accumulated time', () => {
    let timer = createTimer();
    timer = startTimer(timer, 1000);
    timer = pauseTimer(timer, 1500); // elapsed: 500
    assert.equal(getElapsedMs(timer, 2000), 500);
  });

  await t.test('resumes and adds to accumulated time', () => {
    let timer = createTimer();
    timer = startTimer(timer, 1000);
    timer = pauseTimer(timer, 1500); // 500
    timer = startTimer(timer, 2000); 
    assert.equal(getElapsedMs(timer, 2500), 1000);
  });

  await t.test('resets while paused', () => {
    let timer = createTimer();
    timer = startTimer(timer, 1000);
    timer = pauseTimer(timer, 1500);
    timer = resetTimer(timer, 2000);
    assert.equal(getElapsedMs(timer, 2500), 0);
    assert.equal(timer.lastStartedAt, null);
  });

  await t.test('resets while running (new-session reset)', () => {
    let timer = createTimer();
    timer = startTimer(timer, 1000);
    timer = resetTimer(timer, 2000);
    assert.equal(getElapsedMs(timer, 2500), 500);
    assert.equal(timer.lastStartedAt, 2000);
  });
  
  await t.test('repeated start/pause idempotence', () => {
    let timer = createTimer();
    timer = startTimer(timer, 100);
    timer = startTimer(timer, 200); // ignored
    assert.equal(getElapsedMs(timer, 300), 200);
    timer = pauseTimer(timer, 400);
    timer = pauseTimer(timer, 500); // ignored
    assert.equal(getElapsedMs(timer, 600), 300);
  });

  await t.test('large delayed sampling without drift', () => {
    let timer = createTimer();
    timer = startTimer(timer, 0);
    timer = pauseTimer(timer, 5000000);
    assert.equal(getElapsedMs(timer, 5000000), 5000000);
  });

  await t.test('formats elapsed correctly', () => {
    assert.equal(formatElapsed(0), '00:00');
    assert.equal(formatElapsed(999), '00:00');
    assert.equal(formatElapsed(1000), '00:01');
    assert.equal(formatElapsed(60000), '01:00');
    assert.equal(formatElapsed(61000), '01:01');
    assert.equal(formatElapsed(3599000), '59:59');
    assert.equal(formatElapsed(3600000), '1:00:00');
    assert.equal(formatElapsed(3661000), '1:01:01');
  });
});
