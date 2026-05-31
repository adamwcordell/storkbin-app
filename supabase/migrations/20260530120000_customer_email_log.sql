-- Idempotent log for transactional customer emails (Email Plan in business docs).
create table if not exists public.customer_email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  email_type text not null,
  reference_key text not null,
  recipient_email text not null,
  subject text not null,
  sent_at timestamptz not null default now(),
  resend_ok boolean not null default true,
  error_message text null,
  constraint customer_email_log_type_ref_unique unique (email_type, reference_key)
);

create index if not exists customer_email_log_user_id_idx on public.customer_email_log (user_id);
create index if not exists customer_email_log_email_type_sent_at_idx on public.customer_email_log (email_type, sent_at desc);

comment on table public.customer_email_log is 'Dedupes Resend transactional emails (booking, tracking, delivery, payment warnings).';
