CREATE TABLE IF NOT EXISTS quickque_anonymous_usage_daily (
  day date NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
  event text NOT NULL CHECK (event IN ('app_open','script_created','voice_used','reading_session')),
  app_surface text NOT NULL DEFAULT '',
  script_purpose text NOT NULL DEFAULT '',
  creation_source text NOT NULL DEFAULT '',
  voice_mode text NOT NULL DEFAULT '',
  event_count bigint NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  script_word_count_sum bigint NOT NULL DEFAULT 0 CHECK (script_word_count_sum >= 0),
  active_seconds_sum bigint NOT NULL DEFAULT 0 CHECK (active_seconds_sum >= 0),
  PRIMARY KEY (day,event,app_surface,script_purpose,creation_source,voice_mode)
);