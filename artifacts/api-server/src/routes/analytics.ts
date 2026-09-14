import { Router, type IRouter } from 'express';
import { RecordAnonymousAnalyticsEventBody } from '@workspace/api-zod';
import { pool } from '@workspace/db';

const router: IRouter = Router();

router.post('/analytics/events', async (req, res): Promise<void> => {
  const parsed = RecordAnonymousAnalyticsEventBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid anonymous analytics event' });
    return;
  }
  const event = parsed.data;
  const dimensions = {
    appSurface: event.appSurface ?? '',
    scriptPurpose: ['script_created', 'reading_session'].includes(event.event) ? event.scriptPurpose ?? '' : '',
    creationSource: event.event === 'script_created' ? event.creationSource ?? '' : '',
    voiceMode: event.event === 'voice_used' ? event.voiceMode ?? '' : '',
  };
  await pool.query(`INSERT INTO quickque_anonymous_usage_daily
    (event,app_surface,script_purpose,creation_source,voice_mode,event_count,script_word_count_sum,active_seconds_sum)
    VALUES($1,$2,$3,$4,$5,1,$6,$7)
    ON CONFLICT(day,event,app_surface,script_purpose,creation_source,voice_mode)
    DO UPDATE SET
      event_count=quickque_anonymous_usage_daily.event_count+1,
      script_word_count_sum=quickque_anonymous_usage_daily.script_word_count_sum+EXCLUDED.script_word_count_sum,
      active_seconds_sum=quickque_anonymous_usage_daily.active_seconds_sum+EXCLUDED.active_seconds_sum`,
    [
      event.event,
      dimensions.appSurface,
      dimensions.scriptPurpose,
      dimensions.creationSource,
      dimensions.voiceMode,
      event.event === 'reading_session' ? event.scriptWordCount ?? 0 : 0,
      event.event === 'reading_session' ? event.activeSeconds ?? 0 : 0,
    ]);
  res.status(204).end();
});

export default router;