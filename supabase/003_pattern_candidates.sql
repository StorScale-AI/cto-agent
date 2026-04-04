-- 003: Pattern graduation candidates
-- Stores error signatures that appear 3+ times as candidates for pattern matchers

CREATE TABLE IF NOT EXISTS cto_agent_pattern_candidates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_name text NOT NULL,
  error_signature text NOT NULL,
  occurrence_count integer DEFAULT 1,
  repos text[] DEFAULT '{}',
  last_seen timestamptz,
  status text DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected', 'implemented')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cto_agent_pattern_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_candidates" ON cto_agent_pattern_candidates
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_pattern_candidates_status
  ON cto_agent_pattern_candidates (status, created_at DESC);
