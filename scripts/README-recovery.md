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

## Neon Data API + Clerk: two real traps

Both cost hours; both are invisible from the error message, which is always
the unhelpful `{"message":"jwk not found"}`.

**1. `role_names` is deprecated and silently narrowing.** Passing
`role_names: ["authenticated"]` to `POST /projects/{id}/jwks` looks correct but
excludes `authenticator` -- the role PostgREST actually connects as. Omit the
field entirely; the default maps `authenticator`, `authenticated` and
`anonymous`. Likewise omit `jwt_audience` rather than passing `""`, which the
API rejects with "jwt audience must not be empty".

**2. "Use Managed Better Auth" wins over your own provider.** Leaving that
checkbox ticked while enabling the Data API creates a `better_auth` integration
(visible at `GET /projects/{id}/auth/integrations`) whose JWKS URL points at
Neon's own `*.neonauth.*` host. The Data API then validates every token against
*that* key set, so a Clerk token fails with `jwk not found` -- and so does a
deliberately bogus one, which is the tell: if a garbage `kid` and a real `kid`
produce the identical error, no usable key set is loaded at all.

Remove it with `DELETE /projects/{id}/auth/integration/better_auth`, then
restart the compute so the Data API reloads.
