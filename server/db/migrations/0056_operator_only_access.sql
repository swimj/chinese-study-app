CREATE TABLE service_controls_next (
  control_key TEXT PRIMARY KEY CHECK (
    control_key IN ('maintenance_mode', 'provider_work_enabled', 'operator_only')
  ),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0)
);
INSERT INTO service_controls_next (control_key, enabled, updated_at, actor_id)
SELECT control_key, enabled, updated_at, actor_id FROM service_controls;
INSERT INTO service_controls_next (control_key, enabled, updated_at, actor_id)
VALUES ('operator_only', 0, '1970-01-01T00:00:00.000Z', 'system_default');
DROP TABLE service_controls;
ALTER TABLE service_controls_next RENAME TO service_controls;
