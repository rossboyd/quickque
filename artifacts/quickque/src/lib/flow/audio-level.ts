/** Latest numeric-only microphone measurement. Never retain PCM or transcripts. */
export interface AudioLevelSample {
  level: number;
  receivedAt: number;
}

export const AUDIO_LEVEL_STALE_MS = 500;

export function parseAudioLevel(
  payload: unknown,
  activeGeneration: number,
  listening: boolean,
  now: number,
): AudioLevelSample | null {
  if (!listening || !payload || typeof payload !== "object") return null;
  const event = payload as Record<string, unknown>;
  if (
    event.type !== "audio_level" ||
    event.generation !== activeGeneration ||
    !Number.isSafeInteger(activeGeneration) ||
    typeof event.level !== "number" ||
    !Number.isFinite(event.level) ||
    event.level < 0 ||
    event.level > 1 ||
    !Number.isFinite(now) ||
    now < 0
  ) return null;
  return { level: event.level, receivedAt: now };
}

export function liveAudioLevel(
  sample: AudioLevelSample,
  now: number,
  listening: boolean,
): number {
  const age = now - sample.receivedAt;
  if (
    !listening || !Number.isFinite(age) ||
    age < 0 || age > AUDIO_LEVEL_STALE_MS ||
    !Number.isFinite(sample.level) || sample.level < 0 || sample.level > 1
  ) return 0;
  return sample.level;
}