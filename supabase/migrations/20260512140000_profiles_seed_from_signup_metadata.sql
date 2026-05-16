-- When email confirmation is required, signUp returns no session so the client cannot
-- INSERT into profiles (RLS requires authenticated). This trigger seeds profiles from
-- raw_user_meta_data populated by PublicSignupPage (address_* + full_name).

create or replace function public.handle_new_user_profile_from_signup_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_line1 text := nullif(btrim(coalesce(meta->>'address_line1', '')), '');
begin
  if v_line1 is null then
    return new;
  end if;

  insert into public.profiles (
    id,
    full_name,
    email,
    address_line1,
    address_line2,
    city,
    state,
    zip
  )
  values (
    new.id,
    nullif(btrim(coalesce(meta->>'full_name', '')), ''),
    coalesce(nullif(btrim(coalesce(meta->>'signup_profile_email', '')), ''), new.email),
    v_line1,
    nullif(btrim(coalesce(meta->>'address_line2', '')), ''),
    nullif(btrim(coalesce(meta->>'city', '')), ''),
    upper(nullif(btrim(coalesce(meta->>'state', '')), '')),
    nullif(btrim(coalesce(meta->>'zip', '')), '')
  )
  on conflict (id) do update set
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    email = coalesce(nullif(excluded.email, ''), public.profiles.email),
    address_line1 = coalesce(nullif(excluded.address_line1, ''), public.profiles.address_line1),
    address_line2 = coalesce(excluded.address_line2, public.profiles.address_line2),
    city = coalesce(nullif(excluded.city, ''), public.profiles.city),
    state = coalesce(nullif(excluded.state, ''), public.profiles.state),
    zip = coalesce(nullif(excluded.zip, ''), public.profiles.zip);

  return new;
exception
  when others then
    raise warning 'handle_new_user_profile_from_signup_metadata: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile_from_metadata on auth.users;

create trigger on_auth_user_created_profile_from_metadata
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user_profile_from_signup_metadata();
