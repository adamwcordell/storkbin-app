-- Waive minimum-term early termination penalty for bins after subscription reactivation.
-- Return shipping when the bin is still in storage remains a separate charge at cancellation.

alter table public.boxes
  add column if not exists early_termination_fee_waived boolean not null default false;

comment on column public.boxes.early_termination_fee_waived is
  'When true, no early-break cancellation fee applies (set when customer completes subscription reactivation checkout).';
