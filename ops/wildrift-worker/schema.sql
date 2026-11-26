CREATE TABLE IF NOT EXISTS scrape_job_state (
  job text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_success_at timestamptz,
  last_started_at timestamptz,
  last_executor text,
  last_run_id uuid
);
CREATE TABLE IF NOT EXISTS scrape_runs (
  id uuid PRIMARY KEY,
  job text NOT NULL REFERENCES scrape_job_state(job),
  executor text NOT NULL CHECK (executor IN ('kolvrt', 'github')),
  trigger text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed', 'interrupted')),
  step text,
  result text,
  log_tail text,
  revision text,
  run_url text,
  CHECK ((status = 'running') = (finished_at IS NULL))
);
CREATE INDEX IF NOT EXISTS scrape_runs_recent_idx ON scrape_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS scrape_runs_active_idx ON scrape_runs (heartbeat_at) WHERE status = 'running';
INSERT INTO scrape_job_state (job) VALUES ('stats'), ('riftgg'), ('guides'), ('patch-notes') ON CONFLICT DO NOTHING;
