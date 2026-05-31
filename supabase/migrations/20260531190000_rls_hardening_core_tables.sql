-- RLS hardening for StorkBin core customer tables.
-- NOT APPLIED automatically — review audit + risk section before: supabase db push
--
-- Sync admin emails here with Supabase secret ADMIN_EMAILS and VITE_ADMIN_EMAILS.
-- Default seed matches current project admin.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_storkbin_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(nullif(trim(auth.jwt()->>'email'), '')) = any (
      array[
        'admin@storkbin.com'
      ]::text[]
    ),
    false
  );
$$;

comment on function public.is_storkbin_admin() is
  'True when JWT email is in the StorkBin admin allowlist (keep in sync with ADMIN_EMAILS / VITE_ADMIN_EMAILS).';

create or replace function public.user_owns_box(p_box_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boxes b
    where b.id = p_box_id
      and b.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- boxes (CRITICAL: currently no effective RLS on production)
-- ---------------------------------------------------------------------------

alter table public.boxes enable row level security;
alter table public.boxes force row level security;

drop policy if exists "boxes_select_own_or_admin" on public.boxes;
create policy "boxes_select_own_or_admin"
  on public.boxes
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_storkbin_admin());

drop policy if exists "boxes_insert_own" on public.boxes;
create policy "boxes_insert_own"
  on public.boxes
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "boxes_update_own_or_admin" on public.boxes;
create policy "boxes_update_own_or_admin"
  on public.boxes
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_storkbin_admin())
  with check (user_id = auth.uid() or public.is_storkbin_admin());

drop policy if exists "boxes_delete_own_or_admin" on public.boxes;
create policy "boxes_delete_own_or_admin"
  on public.boxes
  for delete
  to authenticated
  using (user_id = auth.uid() or public.is_storkbin_admin());

-- ---------------------------------------------------------------------------
-- items (CRITICAL: currently no effective RLS on production)
-- ---------------------------------------------------------------------------

alter table public.items enable row level security;
alter table public.items force row level security;

drop policy if exists "items_select_own_box_or_admin" on public.items;
create policy "items_select_own_box_or_admin"
  on public.items
  for select
  to authenticated
  using (
    public.is_storkbin_admin()
    or public.user_owns_box(box_id)
  );

drop policy if exists "items_insert_own_box" on public.items;
create policy "items_insert_own_box"
  on public.items
  for insert
  to authenticated
  with check (public.user_owns_box(box_id));

drop policy if exists "items_update_own_box_or_admin" on public.items;
create policy "items_update_own_box_or_admin"
  on public.items
  for update
  to authenticated
  using (public.is_storkbin_admin() or public.user_owns_box(box_id))
  with check (public.is_storkbin_admin() or public.user_owns_box(box_id));

drop policy if exists "items_delete_own_box_or_admin" on public.items;
create policy "items_delete_own_box_or_admin"
  on public.items
  for delete
  to authenticated
  using (public.is_storkbin_admin() or public.user_owns_box(box_id));

-- ---------------------------------------------------------------------------
-- shipments (RLS already blocks anon; tighten authenticated scope)
-- ---------------------------------------------------------------------------

alter table public.shipments enable row level security;
alter table public.shipments force row level security;

drop policy if exists "shipments_select_own_or_admin" on public.shipments;
create policy "shipments_select_own_or_admin"
  on public.shipments
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_storkbin_admin());

drop policy if exists "shipments_insert_own" on public.shipments;
create policy "shipments_insert_own"
  on public.shipments
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "shipments_update_own_or_admin" on public.shipments;
create policy "shipments_update_own_or_admin"
  on public.shipments
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_storkbin_admin())
  with check (user_id = auth.uid() or public.is_storkbin_admin());

drop policy if exists "shipments_delete_admin_only" on public.shipments;
create policy "shipments_delete_admin_only"
  on public.shipments
  for delete
  to authenticated
  using (public.is_storkbin_admin());

-- ---------------------------------------------------------------------------
-- shipment_boxes
-- ---------------------------------------------------------------------------

alter table public.shipment_boxes enable row level security;
alter table public.shipment_boxes force row level security;

drop policy if exists "shipment_boxes_select_own_or_admin" on public.shipment_boxes;
create policy "shipment_boxes_select_own_or_admin"
  on public.shipment_boxes
  for select
  to authenticated
  using (
    public.is_storkbin_admin()
    or user_id = auth.uid()
    or public.user_owns_box(box_id)
  );

drop policy if exists "shipment_boxes_insert_own" on public.shipment_boxes;
create policy "shipment_boxes_insert_own"
  on public.shipment_boxes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.user_owns_box(box_id)
    and exists (
      select 1 from public.shipments s
      where s.id = shipment_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "shipment_boxes_update_admin_only" on public.shipment_boxes;
create policy "shipment_boxes_update_admin_only"
  on public.shipment_boxes
  for update
  to authenticated
  using (public.is_storkbin_admin())
  with check (public.is_storkbin_admin());

drop policy if exists "shipment_boxes_delete_admin_only" on public.shipment_boxes;
create policy "shipment_boxes_delete_admin_only"
  on public.shipment_boxes
  for delete
  to authenticated
  using (public.is_storkbin_admin());

-- ---------------------------------------------------------------------------
-- profiles (RLS partially present; add missing SELECT/UPDATE)
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists "profiles_insert_own_for_authenticated" on public.profiles;
create policy "profiles_insert_own_for_authenticated"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_storkbin_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- customer_email_log (apply when table exists on remote — local migration 20260530120000)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'customer_email_log'
  ) then
    execute 'alter table public.customer_email_log enable row level security';
    execute 'alter table public.customer_email_log force row level security';
    -- No policies: anon/authenticated denied; service_role bypasses RLS.
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- admin_ops_bins view
-- View definition is not in repo. After policies above, the view runs as
-- security invoker: admins see all rows; customers/anon see only allowed rows.
-- If anon still sees rows, recreate the view in Supabase SQL editor with:
--   WHERE public.is_storkbin_admin()
-- for admin-only dashboards (ScanResolvePage admin path uses this view).
-- ---------------------------------------------------------------------------
