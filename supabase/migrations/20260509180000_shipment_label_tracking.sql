-- FedEx automation: label purchase failures + tracking poll cursor + last carrier text
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS label_failure_reason text;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS last_tracking_poll_at timestamptz;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS carrier_tracking_last_detail text;

COMMENT ON COLUMN public.shipments.label_failure_reason IS
  'Set when FedEx Ship fails after Stripe paid; label_status becomes purchase_failed.';

COMMENT ON COLUMN public.shipments.last_tracking_poll_at IS
  'Last successful FedEx Track poll for this shipment (sweep-shipment-tracking).';

COMMENT ON COLUMN public.shipments.carrier_tracking_last_detail IS
  'Human-readable snippet from the latest FedEx tracking payload.';
