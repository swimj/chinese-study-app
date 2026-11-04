-- Poll only active dispatch metadata; completed session evidence stays retained.
CREATE INDEX idx_vocabulary_dispatch_queued
  ON vocabulary_post_session_dispatches(created_at, dispatch_id)
  WHERE status = 'queued';
CREATE INDEX idx_vocabulary_dispatch_running_expiry
  ON vocabulary_post_session_dispatches(expires_at)
  WHERE status = 'running';
