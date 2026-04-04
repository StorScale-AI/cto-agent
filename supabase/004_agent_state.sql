-- 004: Agent state persistence (key-value store)
-- Stores dispatch logs, seen run IDs, and other state that must survive restarts

CREATE TABLE IF NOT EXISTS cto_agent_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE cto_agent_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_state" ON cto_agent_state
  FOR ALL USING (auth.role() = 'service_role');

-- Seed initial rows
INSERT INTO cto_agent_state (key, value) VALUES
  ('dispatch_log', '{}'),
  ('seen_runs', '[]')
ON CONFLICT (key) DO NOTHING;
