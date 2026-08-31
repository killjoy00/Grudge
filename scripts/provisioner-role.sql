-- Run as the Neon owner AFTER creating a login role named app_provisioner in
-- the Neon Console. No password belongs in source control.

begin;

-- Neon Console creates ordinary roles without elevated attributes. Abort if a
-- similarly named role was created some other way with more authority.
do $$
begin
  if exists (
    select 1 from pg_roles
     where rolname = 'app_provisioner'
       and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception 'app_provisioner must be an ordinary non-BYPASSRLS role';
  end if;
end $$;

do $$
begin
  execute format(
    'grant connect on database %I to app_provisioner',
    current_database()
  );
end $$;

revoke all on schema public from app_provisioner;
grant usage on schema public to app_provisioner;
grant usage on type public.citext to app_provisioner;

revoke all on all tables in schema public from app_provisioner;
revoke all on all sequences in schema public from app_provisioner;

-- The broad pipeline credential is no longer a provisioning credential. Only
-- the narrow Vercel role can call this allowlist-checked SECURITY DEFINER
-- function, and it has no direct table privileges.
revoke all on function public.provision_profile(text, citext, text)
  from public, authenticated, app_user, app_pipeline, app_provisioner;
grant execute on function public.provision_profile(text, citext, text)
  to app_provisioner;

-- Added by the membership/recap/history migration. Keep this setup script
-- usable before or after that migration exists.
do $$
begin
  if to_regprocedure('public.sync_profile_membership(citext)') is not null then
    execute 'revoke all on function public.sync_profile_membership(citext) from public, authenticated, app_user, app_pipeline, app_provisioner';
    execute 'grant execute on function public.sync_profile_membership(citext) to app_provisioner';
  end if;
end $$;

commit;
