-- Fixes: "new row violates row-level security policy for table profiles" when saving
-- account address if no row existed yet (client upsert performs an INSERT).

drop policy if exists "profiles_insert_own_for_authenticated" on public.profiles;

create policy "profiles_insert_own_for_authenticated"
on public.profiles
for insert
to authenticated
with check (id = (select auth.uid()));
