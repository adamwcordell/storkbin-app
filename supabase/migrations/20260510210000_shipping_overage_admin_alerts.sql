-- Admin alert pipeline for carrier adjustments (FedEx re-rate / invoice surcharges)
ALTER TABLE public.shipping_overage_events
  ADD COLUMN IF NOT EXISTS admin_alert_sent_at timestamptz;

ALTER TABLE public.shipping_overage_events
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

ALTER TABLE public.shipping_overage_events
  ADD COLUMN IF NOT EXISTS dismissed_by text;

COMMENT ON COLUMN public.shipping_overage_events.admin_alert_sent_at IS
  'When ops was emailed about this event (Resend); null if email not configured or send failed.';

CREATE INDEX IF NOT EXISTS shipping_overage_events_status_created_idx
  ON public.shipping_overage_events (detection_status, created_at DESC);
