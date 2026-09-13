import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearFlowDebug, DEBUG_LIMIT, formatFlowDebug, getFlowDebugSnapshot,
  recordFlowDebug, recordFlowEvent, subscribeFlowDebug,
} from './diagnostics.ts';

test('records chronological checkpoints and notifies/unsubscribes', () => {
  clearFlowDebug();
  let notifications = 0;
  const unsubscribe = subscribeFlowDebug(() => notifications++);
  recordFlowDebug('listener_begin', 10);
  recordFlowDebug('listener_ready', 10);
  recordFlowDebug('command_sent', 10, undefined, 'status');
  unsubscribe();
  recordFlowEvent({ type: 'diagnostic', generation: 10, stage: 'helper_boot' }, 10);
  assert.equal(notifications, 3);
  assert.deepEqual(getFlowDebugSnapshot().map(x => x.code),
    ['listener_begin', 'listener_ready', 'command_sent', 'helper_boot']);
  assert.match(formatFlowDebug(getFlowDebugSnapshot()[2]), /\[status\] #10/);
});

test('never retains speech, raw errors, paths, arbitrary codes or extra fields', () => {
  clearFlowDebug();
  const privateText = 'SECRET_TRANSCRIPT /Users/someone/private.wav';
  recordFlowEvent({ type: 'transcript', generation: 10, text: privateText, stage: 'helper_boot' }, 10);
  recordFlowEvent({ type: 'diagnostic', generation: 10, stage: privateText }, 10);
  recordFlowDebug(privateText, 10);
  assert.equal(getFlowDebugSnapshot().length, 0);
  recordFlowEvent({ type: 'error', generation: 10, code: privateText, message: privateText }, 10);
  recordFlowEvent({ type: 'diagnostic', generation: 10, stage: 'apple_assets_check_begin', message: privateText }, 10);
  recordFlowDebug('command_sent', privateText, Infinity, privateText);
  assert.ok(!JSON.stringify(getFlowDebugSnapshot()).includes(privateText));
  assert.ok(!getFlowDebugSnapshot().at(-1)?.action);
  assert.ok(!getFlowDebugSnapshot().at(-1)?.generation);
});

test('keeps numeric exit metadata private and filters stale exit events', () => {
  clearFlowDebug();
  const privatePayload = 'SECRET_TRANSCRIPT /Users/someone/private.wav';
  recordFlowEvent({
    type: 'diagnostic', generation: 10, stage: 'helper_exit_code', value: 17,
    payload: privatePayload,
  }, 10);
  recordFlowEvent({
    type: 'diagnostic', generation: 10, stage: 'helper_exit_signal', value: '9',
    payload: privatePayload,
  }, 10);
  recordFlowEvent({
    type: 'diagnostic', generation: 10, stage: 'helper_boot', value: 23,
    payload: privatePayload,
  }, 10);
  recordFlowEvent({
    type: 'diagnostic', generation: 9, stage: 'helper_exit_signal', value: 9,
    payload: privatePayload,
  }, 10);

  const snapshot = getFlowDebugSnapshot();
  assert.deepEqual(snapshot.map(entry => entry.code),
    ['helper_exit_code', 'helper_exit_signal', 'helper_boot', 'stale_event']);
  assert.equal(snapshot[0].value, 17);
  assert.equal(snapshot[1].value, undefined);
  assert.equal(snapshot[2].value, undefined);
  assert.equal(snapshot[3].value, undefined);
  assert.ok(!JSON.stringify(snapshot).includes(privatePayload));
});

test('bounded history survives high volume and clear removes it', () => {
  clearFlowDebug();
  for (let i = 0; i < 1000; i++) recordFlowDebug('command_sent', i);
  assert.equal(getFlowDebugSnapshot().length, DEBUG_LIMIT);
  assert.equal(getFlowDebugSnapshot().at(-1)?.generation, 999);
  recordFlowDebug('command_sent', 999);
  assert.equal(getFlowDebugSnapshot().length, DEBUG_LIMIT);
  clearFlowDebug();
  assert.equal(getFlowDebugSnapshot().length, 0);
});

test('distinguishes stale events, timeout and confirmed cleanup', () => {
  clearFlowDebug();
  recordFlowEvent({ type: 'status', status: 'ready', generation: 1 }, 2);
  recordFlowDebug('watchdog_expired', 2, 120000);
  recordFlowDebug('command_sent', 3, undefined, 'stop');
  recordFlowDebug('command_resolved', 3, 7, 'stop');
  assert.deepEqual(getFlowDebugSnapshot().map(x => x.code),
    ['stale_event', 'watchdog_expired', 'command_sent', 'command_resolved']);
});

test('records Apple preparation stages and ignores stale warning/error payload details', () => {
  clearFlowDebug();
  const privateStderr = 'SECRET /Users/name/native.log';
  recordFlowEvent({ type: 'diagnostic', generation: 10, stage: 'apple_analyzer_prepare_begin' }, 10);
  recordFlowEvent({ type: 'diagnostic', generation: 10, stage: 'apple_analyzer_prepare_complete' }, 10);
  recordFlowEvent({
    type: 'warning',
    generation: 9,
    code: 'audio_dropped',
    droppedFrames: 16_000,
    queuedFrames: 100,
  }, 10);
  recordFlowEvent({
    type: 'error',
    generation: 9,
    code: 'overrun',
    message: privateStderr,
    details: { stderr: privateStderr, exitCode: 1, signal: null },
  }, 10);
  const snapshot = getFlowDebugSnapshot();
  assert.deepEqual(snapshot.map(entry => entry.code), [
    'apple_analyzer_prepare_begin',
    'apple_analyzer_prepare_complete',
    'stale_event',
  ]);
  assert.ok(!JSON.stringify(snapshot).includes(privateStderr));
});
test('audio diagnostics retain known failure codes without raw errors or voice data', async () => {
  const { recordAudioFailure } = await import('./diagnostics.ts');
  clearFlowDebug();
  recordFlowDebug('audio_generate_begin');
  recordFlowDebug('audio_model_load');
  recordFlowDebug('audio_generation');
  recordFlowDebug('audio_generate_failed');
  recordAudioFailure('SCENE_SPEECH_TURBO_GENERATION: private script /Users/name/reference.wav');
  recordAudioFailure('SECRET_CUSTOM_CODE: private voice');
  assert.deepEqual(getFlowDebugSnapshot().map(x => x.code), [
    'audio_generate_begin', 'audio_model_load', 'audio_generation', 'audio_generate_failed',
    'error:SCENE_SPEECH_TURBO_GENERATION',
  ]);
  assert.doesNotMatch(JSON.stringify(getFlowDebugSnapshot()), /private|Users|SECRET/);
});
