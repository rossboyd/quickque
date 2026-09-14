import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './desktop';

export type AnonymousAnalyticsEvent = {
  event: 'app_open' | 'script_created' | 'voice_used' | 'reading_session';
  appSurface?: 'mac' | 'browser';
  scriptPurpose?: 'presentation' | 'performance';
  creationSource?: 'blank' | 'sample' | 'duplicate' | 'import';
  voiceMode?: 'voice_follow' | 'scene_partner' | 'chatterbox';
  scriptWordCount?: number;
  activeSeconds?: number;
};

export function recordAnonymousAnalytics(event: AnonymousAnalyticsEvent): void {
  const payload = { ...event, appSurface: isDesktop() ? 'mac' as const : 'browser' as const };
  if (isDesktop()) {
    void invoke('record_anonymous_analytics_event', { event: payload }).catch(() => undefined);
    return;
  }
  void fetch('/api/analytics/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
    credentials: 'omit',
  }).catch(() => undefined);
}