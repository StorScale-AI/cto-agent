-- 002: Tighten RLS policies to service_role only
-- Previously USING (true) allowed any authenticated user to read/write

-- Drop old permissive policies
DROP POLICY IF EXISTS "service_role_full_incidents" ON cto_agent_incidents;
DROP POLICY IF EXISTS "service_role_full_snapshots" ON cto_agent_health_snapshots;

-- Create restrictive policies (service_role only)
CREATE POLICY "service_role_only_incidents" ON cto_agent_incidents
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_only_snapshots" ON cto_agent_health_snapshots
  FOR ALL USING (auth.role() = 'service_role');
