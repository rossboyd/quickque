/** The allowance covers audible playback, not model loading or paused time. */
export class AudioTrial {
  private used = 0;
  private readonly limit: number;
  constructor(limit = 30) { this.limit = limit; }
  remaining(licensed: boolean) { return licensed ? Infinity : Math.max(0, this.limit - this.used); }
  consume(seconds: number) { if (Number.isFinite(seconds) && seconds > 0) this.used += seconds; }
}
export function audioTrialEnded(): Error {
  window.dispatchEvent(new Event('quickque:upgrade'));
  return new Error('AUDIO_TRIAL_LIMIT: This session’s free voice time is complete. Continue with Free to read manually.');
}

const trials = new Map<string, AudioTrial>();
export function audioTrialFor(scriptId: string) {
  let trial = trials.get(scriptId);
  if (!trial) { trial = new AudioTrial(); trials.set(scriptId, trial); }
  return trial;
}
