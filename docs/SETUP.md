# Setup — the parts that need you

Ordered by when they block me. Task 1 and Task 2 unblock real work right now;
Task 4 (Vercel) isn't needed until the site exists, and is here so you can see
what's coming.

Everything here you do once. Nothing in this file should ever be committed —
`.gitignore` already covers `.env` and `.env*.local`.

---

## Task 1 — ESPN cookies and the history backfill (~10 minutes)

This is the one-time authenticated capture of seasons 2018-2025. Step 1 proved
the data exists (prior seasons return `401 AUTH_LEAGUE_NOT_VISIBLE`, while a
nonexistent league returns `404`) but is not publicly readable.

**Run this on your own machine, not in a codespace or CI.** `espn_s2` is a
long-lived credential for your whole ESPN account. The script reads both cookies
from the environment, never writes them to disk, and redacts them from all output
— but the safest handling is that they never leave your laptop. Please don't
paste them into our chat either; the committed JSON is all I need.

### 1a. Copy the two cookies

1. Log in at <https://fantasy.espn.com> in Chrome, and open the Grudge Match league.
2. `F12` (or ⌥⌘I) → **Application** tab → left sidebar **Storage → Cookies →**
   `https://fantasy.espn.com`.
3. Find the row named **`SWID`**. Copy its Value. It looks like
   `{164FA15F-6CCC-4240-8ED4-940DC77B6F1A}` — **keep the curly braces**, they are
   part of the value. (Yours specifically should start `{164FA15F` — that's the
   SWID the public API already shows as owner of team 1.)
4. Find the row named **`espn_s2`**. Copy its Value. It is ~300 characters and
   contains `%` escapes. **Copy it whole and do not decode it.** Truncating this
   is the single most common reason the script fails.

> Firefox: Storage tab → Cookies. Safari: enable Develop menu → Web Inspector →
> Storage. In any browser, double-click the value and select-all rather than
> dragging, so you don't clip the end.

### 1b. Run it

```bash
git clone https://github.com/killjoy00/Grudge.git
cd Grudge

# quote with SINGLE quotes -- espn_s2 contains characters your shell will eat otherwise
export ESPN_SWID='{164FA15F-6CCC-4240-8ED4-940DC77B6F1A}'
export ESPN_S2='AEBxxxxx...paste the whole thing...'

# check the cookies work before pulling anything (writes nothing)
node scripts/backfill-history.mjs --probe
```

Expected on success:

```
  2026 (public baseline): HTTP 200
  2025 via seasons      : HTTP 200
  ...
Cookies work. Reachable via: seasons
```

If you get `Still 401 on every prior season`, the script prints the four likely
causes. The usual one is a clipped `espn_s2`.

Then the real run — about 2 minutes, ~150 requests, deliberately rate-limited:

```bash
node scripts/backfill-history.mjs
```

It writes `data/history/{2018..2025}/` with `league.json.gz`, 17 per-week
`boxscores/spNN.json.gz`, and a plain `manifest.json` recording which URL shape
answered and any warnings. **Each season is staged and only promoted once every
request for it succeeded**, so a season that fails part-way leaves nothing behind
and you can never commit half a season. Re-running a season overwrites it
wholesale and produces byte-identical output.

Expect **~1.1 MB per season, ~9 MB for all eight**. The raw payloads are stored
minified and gzipped: pretty-printed they run ~13 MB a season, which would put
~100 MB into git for no benefit, since these are write-once API captures nobody
hand-edits. Content is unchanged — to read one:

```bash
gunzip -c data/history/2021/league.json.gz | jq '.teams[].name'
```

The script exits **1** if any season failed, even if others succeeded, so a
partial run is never silently mistaken for a complete one.

```bash
git checkout -b history-backfill
git add data/history && git commit -m "Import league history 2018-2025"
git push -u origin history-backfill
```

Then tell me it's pushed. **The first thing I'll check is whether ESPN reuses
team IDs across seasons** — that decides whether rivalry records join on team or
on owner SWID, and I'd rather find out from your data than guess.

If some seasons fail, push the ones that worked. Partial history is fine; the
schema keys everything by season.

> `--no-boxscores` cuts it to ~16 requests if you just want records and
> matchups, but you'd lose historical optimal-lineup analysis. I'd take the full
> run. `--skip-probe` skips the cookie check, useful when re-running one season.

---

## Task 2 — Neon + Clerk project

Neon provides Postgres; Clerk provides authentication. The web connection uses
an ordinary role and remains subject to RLS. A second ordinary role can execute
only the two membership provisioning functions. Neither credential can bypass
RLS, and the pipeline's broader credential never goes into Vercel.

### 2a. Create the Neon project

1. <https://console.neon.tech> → **New project**.
2. Name `grudge`, region closest to Vercel's default `iad1` (US East) for
   fast server-component queries.
3. Choose the Free plan and wait for provisioning.
4. **Dashboard → Connection Details** → copy the pooled connection string →
   save as `DATABASE_URL`. This owner connection is for migrations only and
   must never be added to Vercel or GitHub Actions.

### 2b. Create the Clerk application

1. <https://dashboard.clerk.com> → **Create application**. Name it `Grudge`.
2. **Email** as the only sign-in option — toggle off phone number and
   username; toggle off password ("Email verification code" or "Email magic
   link" only). Pick **magic link** specifically, not just a code, to match
   what was asked for.
3. **API Keys** page → copy the **Publishable key** (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)
   and **Secret key** (`CLERK_SECRET_KEY`).

### 2c. Use Clerk Invite-only mode (free), not the paid allowlist

Clerk's **Allowlist** is a paid production feature. This app deliberately does
not call that API. Instead:

1. In the Clerk Dashboard, open the **Development** instance.
2. Go to **Access mode** (called **Restrictions** in older dashboard layouts).
3. Select **Invite-only** and save. Its API value is `restricted`.
4. Do not enable **Allowlist** or **Blocklist**.

The commissioner page creates Clerk application invitations. Clerk emails a
single-use link, and an uninvited person cannot open the sign-up flow. The
`league_allowlist` table remains as the app's private roster and ESPN/admin
mapping; despite its historical name, it is not Clerk's paid allowlist.

### 2d. Create and configure Clerk's Production instance

1. At the top of the Clerk Dashboard, select the **Development** instance menu
   → **Create production instance**.
2. Clone the development settings, then switch to **Production** and confirm
   that **Email only**, passwordless sign-in, and **Invite-only** access were
   copied. Allowlist must remain disabled.
3. Add the production domain `grudge.planitnow.us` when prompted and publish the
   DNS records Clerk shows. A `*.vercel.app` URL cannot be the production domain.
4. On **API keys**, copy the live `pk_live_...` and `sk_live_...` values. Use
   these only for Vercel's **Production** environment; Preview and local
   development continue to use the `pk_test_...` and `sk_test_...` keys.
5. On **Webhooks**, add
   `https://grudge.planitnow.us/api/webhooks/clerk`, subscribe to
   `user.created` and `user.updated`, and copy its signing secret.

Development and Production have separate users, invitations, keys, webhooks,
and access-mode settings. Creating Production does not copy development users.

### 2e. Create the narrow Neon provisioner role with SQL

Do **not** create `app_provisioner` from Neon's **Roles & Databases** screen.
Neon grants Console-, CLI-, and API-created roles membership in
`neon_superuser`; the security check correctly rejects that role.

If you already created it in the Console and received
`app_provisioner must be an ordinary...`, delete that just-created role from
**Branches → Roles & Databases**. Then open **SQL Editor**, select the Grudge
database and owner role, generate a unique password in a password manager, and
run this after replacing only the password:

```sql
create role app_provisioner with
  login
  password 'REPLACE_WITH_A_UNIQUE_PASSWORD'
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls;
```

Run the membership migration as the owner, then run the provisioner grants:

```bash
NEON_URL="$DATABASE_URL" node scripts/neon-sql.mjs scripts/migrations/2026-08-31-membership-recaps-history.sql
NEON_URL="$DATABASE_URL" node scripts/neon-sql.mjs scripts/migrations/2026-09-01-unified-history.sql
NEON_URL="$DATABASE_URL" node scripts/neon-sql.mjs scripts/provisioner-role.sql
```

Then load the league record — every season from 2005 on — which is what
`/history` reads:

```bash
npm run history:derive
npm run history:import -- \
  --franchises=data/manual-history/franchises.csv \
  --seasons=data/manual-history/season-results.csv \
  --managers=data/manual-history/managers.csv \
  --manager-seasons=data/manual-history/manager-seasons.csv
```

It is one idempotent transaction, so re-running it after backfilling a new ESPN
season is safe. See [`docs/LEAGUE-HISTORY.md`](LEAGUE-HISTORY.md).

Verify the role before constructing its connection string:

```sql
select r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
       r.rolreplication, r.rolbypassrls,
       pg_has_role(r.oid, 'neon_superuser', 'member') as inherits_neon_superuser
  from pg_roles r
 where r.rolname = 'app_provisioner';
```

Every boolean must be `false`. In **Connection Details**, select
`app_provisioner`, select the pooled connection, and save the bare URL as
`PROVISIONER_DATABASE_URL`.

### 2f. Custom SMTP for the newsletter only

Clerk sends its own magic-link emails, so auth email is already covered — this
step is *only* for the Tuesday recap, which isn't an auth email at all.

1. <https://resend.com> → sign up (free tier: 3,000 emails/month).
2. **Domains → Add Domain** → `planitnow.us`. Add the DKIM/SPF records it gives
   you to your DNS. Wait for **Verified**.
3. **API Keys** → create one → save as `RESEND_API_KEY`.

The Tuesday workflow sends the newsletter after every successful scheduled run.

Put development/local values in `.env.local` (already gitignored):

```bash
DATABASE_URL=postgresql://neondb_owner:...@ep-xxxx.us-east-1.aws.neon.tech/grudge?sslmode=require
APP_DATABASE_URL=postgresql://app_user:...@ep-xxxx-pooler.us-east-1.aws.neon.tech/grudge?sslmode=require
PROVISIONER_DATABASE_URL=postgresql://app_provisioner:...@ep-xxxx-pooler.us-east-1.aws.neon.tech/grudge?sslmode=require
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
RESEND_API_KEY=re_...
```

### 2g. Populate the league roster, then invite from the app

The roster needs 13 rows. Email and team are enough. These rows go only into
Postgres; the Members page creates Clerk invitations as members are activated:

```
email,espn_team_id,is_admin
you@example.com,1,true
...
```

Teams from Step 1, for reference:

| team | name | owner(s) |
|---|---|---|
| 1 | Austin Bubbs | Ryan Mindell (Killjoy00) + byron lafleur |
| 2 | Run and Hide | Nathan Hanna |
| 3 | Your Worst Nightmares | Joe Presley |
| 4 | The Penguins | Michael Chepul |
| 5 | The Penthouse Panda Bear | Ben Wildfire + Jeremy Wildfire |
| 6 | P RIVERS NAS NAS | Samuel Nye |
| 8 | Brightleaf Yuppies | Jonathan Crisp |
| 9 | Raleigh Silly Nannies | John Marks |
| 10 | CTE Deniers | Jordan Chin + Jason Campbell |
| 11 | Taco MacArthur | Gary Camero |

Note there is **no team 7**, and three teams have two owners — so 13 emails for
10 teams.

---

## Task 3 — GitHub Actions secrets (2 minutes, do after Task 2)

**Repo → Settings → Secrets and variables → Actions → New repository secret**:

| secret | from |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Development instance `pk_test_...`; used only by the live-session CI check |
| `CLERK_SECRET_KEY` | Development instance `sk_test_...`; used only by the live-session CI check |
| `APP_DATABASE_URL` | `app_user`'s pooled connection string; used by the test server |
| `PIPELINE_DATABASE_URL` | `app_pipeline`'s pooled connection string; never use the owner URL here |
| `RESEND_API_KEY` | 2f |
| `VERCEL_DEPLOY_HOOK_URL` | Task 4c |

Under **Secrets and variables → Actions → Variables**, add:

| variable | value |
|---|---|
| `RECAP_FROM_EMAIL` | `UNC Grudge Match <recap@planitnow.us>` |
| `RECAP_SITE_URL` | `https://grudge.planitnow.us` |

No ESPN cookies here — the weekly pipeline is unauthenticated by design, which is
the main reason the backfill is a separate one-time script. No Clerk secret here
is used by the weekly pipeline; the development Clerk keys above are only for
the separate admin-gating CI job, which creates and removes a throwaway user.
Recap recipients come from active provisioned profiles; each member controls the
`recap_email_enabled` preference on `/me`.

---

## Task 4 — Vercel and the domain (~10 minutes, needed at Step 6)

Nothing to do yet; here so you can see the shape.

### 4a. Import
<https://vercel.com/new> → import `killjoy00/Grudge` → framework auto-detects
Next.js → **don't deploy yet**, add env vars first.

### 4b. Environment variables
**Settings → Environment Variables**. The owner and pipeline credentials never
belong in Vercel. Production must use Clerk's live keys; Preview/Development
must use the separate development keys:

| name | Vercel scope | value |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production | Production instance `pk_live_...` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Preview, Development | Development instance `pk_test_...` |
| `CLERK_SECRET_KEY` | Production | Production instance `sk_live_...` |
| `CLERK_SECRET_KEY` | Preview, Development | Development instance `sk_test_...` |
| `APP_DATABASE_URL` (`app_user`) | Production, Preview, Development | ordinary pooled app connection |
| `PROVISIONER_DATABASE_URL` (`app_provisioner`) | Production | narrow pooled provisioner connection |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Production | signing secret for the production endpoint |

### 4c. Deploy hook
**Settings → Git → Deploy Hooks** → create one named `weekly-pipeline` on `main`
→ copy the URL into the `VERCEL_DEPLOY_HOOK_URL` secret from Task 3.

### 4d. Domain
**Settings → Domains** → add `grudge.planitnow.us`. Vercel will ask for one
record at your `planitnow.us` DNS host:

```
Type: CNAME    Name: grudge    Value: cname.vercel-dns.com
```

TLS is issued automatically once DNS resolves. Complete Clerk's production DNS
check too, then redeploy Vercel so the live keys and webhook are active.

---

## Quick reference — where each secret is allowed to live

| value | laptop `.env.local` | GitHub secret | Vercel | browser |
|---|:--:|:--:|:--:|:--:|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | ✅ dev key for CI | ✅ | ✅ (that's what "publishable" means) |
| `CLERK_SECRET_KEY` | ✅ | ✅ dev key for CI | ✅ | ❌ **never** |
| `DATABASE_URL` (admin/migrations) | ✅ | — | — | ❌ |
| `APP_DATABASE_URL` (`app_user`) | ✅ | ✅ CI only | ✅ | ❌ |
| `PIPELINE_DATABASE_URL` (`app_pipeline`) | — | ✅ | — | ❌ **never** — bypasses RLS entirely |
| `PROVISIONER_DATABASE_URL` (`app_provisioner`) | ✅ | — | ✅ prod only | ❌ |
| `CLERK_WEBHOOK_SIGNING_SECRET` | ✅ | — | ✅ prod only | ❌ |
| `RESEND_API_KEY` | ✅ | ✅ | — | ❌ |
| `ESPN_SWID` / `ESPN_S2` | ✅ backfill only | ❌ **never** | ❌ | ❌ |
