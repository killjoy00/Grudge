-- Run as the Neon owner AFTER creating app_provisioner with SQL (never with
-- the Neon Console, CLI, or API). Neon grants console-created roles membership
-- in neon_superuser, which is intentionally too powerful for this credential.
-- The exact create/recovery steps are in docs/SETUP.md. No password belongs in
-- source control.

begin;

-- Abort unless the role exists and has neither elevated attributes nor a
-- transitive membership in an elevated role. Checking only rolbypassrls is not
-- enough on Neon because Console roles receive neon_superuser by membership.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_provisioner') then
    raise exception 'app_provisioner does not exist; create it with SQL, not the Neon Console';
  end if;

  if exists (
    select 1 from pg_roles
     where rolname = 'app_provisioner'
       and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) or exists (
    with recursive memberships(roleid) as (
      select roleid
        from pg_auth_members
       where member = (select oid from pg_roles where rolname = 'app_provisioner')
      union
      select parent.roleid
        from pg_auth_members parent
        join memberships child on parent.member = child.roleid
    )
    select 1
      from memberships
      join pg_roles inherited on inherited.oid = memberships.roleid
     where inherited.rolname = 'neon_superuser'
        or inherited.rolsuper
        or inherited.rolcreatedb
        or inherited.rolcreaterole
        or inherited.rolreplication
        or inherited.rolbypassrls
  ) then
    raise exception 'app_provisioner must be an ordinary SQL-created role with no neon_superuser or BYPASSRLS inheritance';
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
