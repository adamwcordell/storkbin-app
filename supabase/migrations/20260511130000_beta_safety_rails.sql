-- Beta safety: throttle ops digest emails + optional admin silence window
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS beta_rail_last_alert_at timestamptz;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS admin_suppress_rail_alerts_until timestamptz;

COMMENT ON COLUMN public.shipments.beta_rail_last_alert_at IS
  'Last time this shipment was included in a beta safety-rails digest email (throttle repeats).';

COMMENT ON COLUMN public.shipments.admin_suppress_rail_alerts_until IS
  'When set and in the future, beta-safety-rails skips digest lines for this shipment.';

-- Single-row heartbeats for cron / sweeps (service role writes from Edge Functions).
CREATE TABLE IF NOT EXISTS public.beta_ops_heartbeat (
  id text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT now(),
  last_summary jsonb
);

ALTER TABLE public.beta_ops_heartbeat ENABLE ROW LEVEL SECURITY;
