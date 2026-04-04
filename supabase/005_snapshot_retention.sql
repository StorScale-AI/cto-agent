-- 005: Health snapshot retention policy
-- Delete snapshots older than 30 days to prevent unbounded growth
-- ~3K-6.5K rows/day estimated

-- Function to clean old snapshots
CREATE OR REPLACE FUNCTION cto_agent_cleanup_old_snapshots()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM cto_agent_health_snapshots
  WHERE checked_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Also clean old resolved incidents (keep 90 days)
CREATE OR REPLACE FUNCTION cto_agent_cleanup_old_incidents()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM cto_agent_incidents
  WHERE resolved_at IS NOT NULL
    AND detected_at < now() - interval '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- To schedule via pg_cron (run in Supabase SQL editor):
-- SELECT cron.schedule('cleanup-cto-snapshots', '0 3 * * *', 'SELECT cto_agent_cleanup_old_snapshots()');
-- SELECT cron.schedule('cleanup-cto-incidents', '0 3 * * *', 'SELECT cto_agent_cleanup_old_incidents()');
