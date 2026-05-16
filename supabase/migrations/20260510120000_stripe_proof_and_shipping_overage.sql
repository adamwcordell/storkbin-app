-- Stripe checkout session id (proves automation FedEx runs only after verified Checkout)
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;

COMMENT ON COLUMN public.shipments.stripe_checkout_session_id IS
  'Stripe Checkout Session id when payment was confirmed via Checkout (customer shipping or initial purchase).';

-- Snapshot at label purchase time (money only; package weight limits enforced at FedEx, not in-app)
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS label_quoted_amount_cents integer;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS label_quoted_currency text DEFAULT 'usd';

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS label_purchased_at timestamptz;

COMMENT ON COLUMN public.shipments.label_quoted_amount_cents IS
  'Shipping amount StorkBin quoted/charged at label purchase (cents), for overage vs carrier-billed reconciliation.';

COMMENT ON COLUMN public.shipments.label_purchased_at IS
  'When FedEx Ship succeeded and a label was created for this shipment.';

-- ---------------------------------------------------------------------------
-- Shipping overage / carrier adjustment events (detection → review → charge)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipping_overage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  shipment_id uuid NOT NULL REFERENCES public.shipments (id) ON DELETE CASCADE,
  box_id text REFERENCES public.boxes (id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'fedex_invoice',
  fedex_tracking_number text,
  fedex_invoice_reference text,
  original_estimated_amount_cents integer,
  carrier_billed_amount_cents integer,
  overage_amount_cents integer,
  currency text NOT NULL DEFAULT 'usd',
  reason_codes jsonb,
  raw_carrier_payload jsonb,
  detection_status text NOT NULL DEFAULT 'detected',
  reviewed_at timestamptz,
  reviewed_by text,
  charge_approved_at timestamptz,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  customer_notified_at timestamptz,
  notes text
);

CREATE INDEX IF NOT EXISTS shipping_overage_events_shipment_id_idx
  ON public.shipping_overage_events (shipment_id);

CREATE INDEX IF NOT EXISTS shipping_overage_events_detection_status_idx
  ON public.shipping_overage_events (detection_status);

CREATE INDEX IF NOT EXISTS shipping_overage_events_user_id_idx
  ON public.shipping_overage_events (user_id);

COMMENT ON TABLE public.shipping_overage_events IS
  'FedEx/carrier billed amount vs quoted charge; workflow is detect → admin review → optional Stripe recovery (no auto-charge until approved).';

COMMENT ON COLUMN public.shipping_overage_events.detection_status IS
  'detected | reviewed | approved | rejected | charged | dismissed';
