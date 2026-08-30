# Re-applying policies after Neon recreates the `authenticated` role

Neon's Data API provisioning insists on creating the `anonymous` and
`authenticated` roles itself, and fails if either already exists. Our schema's
policies all reference `authenticated`, so enabling the Data API needs this
sequence:

1. Drop every policy referencing `authenticated`, then the role:
   ```sql
   do $$ declare r record; begin
     for r in select schemaname, tablename, policyname from pg_policies
              where 'authenticated' = any(roles)
     loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
   end $$;
   drop owned by authenticated;
   drop role authenticated;
   ```
2. Enable the Data API in the Neon console. Neon creates both roles.
3. Re-apply policies and grants:
   ```
   NEON_URL=... node scripts/neon-sql.mjs scripts/reapply-policies.sql
   ```

`reapply-policies.sql` is generated from docs/SCHEMA_PROPOSAL.md -- it is every
`create policy`, `grant`, `revoke`, and RLS toggle in that document, and nothing
else, so it cannot drift from the schema it is meant to restore.

The whole cycle was validated on a local Postgres before being run against the
live database: 30 policies dropped, role dropped and recreated, policies
re-applied, and the 24-check attack suite passed unchanged afterwards.
