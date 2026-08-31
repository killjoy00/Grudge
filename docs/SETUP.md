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

## Task 2 — Neon + Clerk project (~15 minutes)

**Changed from Supabase.** Supabase's free tier turned out to cap you personally
at 2 active free projects across every org you administer — a fresh org doesn't
reset it, confirmed by the error Supabase's own dashboard gave when you tried.
Neon (Postgres) + Clerk (auth) has no such collision with your other projects,
and Neon has an equivalent RLS-to-auth integration (Neon RLS Authorize) that
keeps the "locked week enforced in the DB" guarantee intact — full reasoning
in `docs/SCHEMA_PROPOSAL.md`.

**Heads up before you start:** I've verified the security *model* against a
real local Postgres (24/24 attack-suite checks passing), but not yet the exact
account-setup mechanics below — Neon and Clerk's docs don't fully cover
raw-SQL / non-Drizzle usage. Steps 2a-2c are safe to do now; **hold off on
inviting the other 12 members until I've confirmed the Next.js-to-Neon wiring
against your actual project** — I'll follow up once that's verified rather
than have you redo an invite flow.

### 2a. Create the Neon project

1. <https://console.neon.tech> → **New project**.
2. Name `grudge`, region closest to Vercel's default `iad1` (US East) for
   fast server-component queries.
3. Free plan — 100 projects per account, so this doesn't compete with anything
   else you have. Wait ~30 seconds for provisioning.
4. **Dashboard → Connection Details** → copy the pooled connection string →
   save as `DATABASE_URL`. This is the *admin* connection (used to run
   migrations), not `app_pipeline`'s — you'll create that role via migration,
   with its own generated password, once I write the migration files.

### 2b. Create the Clerk application

1. <https://dashboard.clerk.com> → **Create application**. Name it `Grudge`.
2. **Email** as the only sign-in option — toggle off phone number and
   username; toggle off password ("Email verification code" or "Email magic
   link" only). Pick **magic link** specifically, not just a code, to match
   what was asked for.
3. **API Keys** page → copy the **Publishable key** (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)
   and **Secret key** (`CLERK_SECRET_KEY`).

### 2c. Turn on the allowlist — but don't add emails yet

**Configure → Restrictions → Allowlist** → toggle **Enable allowlist**. Leave
the identifier list empty for now (an enabled allowlist with zero entries
blocks everyone, which is the correct fail-closed state until I've verified
the provisioning webhook). I'll tell you exactly when to add the 13 emails —
right after I confirm a signup actually reaches Postgres correctly.

### 2d. Custom SMTP for the newsletter only

Clerk sends its own magic-link emails, so auth email is already covered — this
step is *only* for the Tuesday recap, which isn't an auth email at all.

1. <https://resend.com> → sign up (free tier: 3,000 emails/month).
2. **Domains → Add Domain** → `planitnow.us`. Add the DKIM/SPF records it gives
   you to your DNS. Wait for **Verified**.
3. **API Keys** → create one → save as `RESEND_API_KEY`.

The Tuesday workflow sends the newsletter after every successful scheduled run.

Put everything from this task in `.env.local` (already gitignored):

```bash
DATABASE_URL=postgresql://neondb_owner:...@ep-xxxx.us-east-1.aws.neon.tech/grudge?sslmode=require
APP_DATABASE_URL=postgresql://app_user:...@ep-xxxx-pooler.us-east-1.aws.neon.tech/grudge?sslmode=require
PROVISIONER_DATABASE_URL=postgresql://app_provisioner:...@ep-xxxx-pooler.us-east-1.aws.neon.tech/grudge?sslmode=require
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
RESEND_API_KEY=re_...
```

### 2e. Send me the allowlist (don't add it to Clerk yet — see the note above)

I need 13 rows — I have the SWIDs and names from Step 1, so email and team is
enough. This feeds two places once verified: Clerk's own allowlist (2c) and
the `league_allowlist` table `provision_profile()` reads from:

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
| `PIPELINE_DATABASE_URL` | `app_pipeline`'s connection string — generated when I write the migration that creates that role (not yet); until then, `DATABASE_URL` from 2a works for local testing only |
| `RESEND_API_KEY` | 2d |
| `VERCEL_DEPLOY_HOOK_URL` | Task 4c |

Under **Secrets and variables → Actions → Variables**, add:

| variable | value |
|---|---|
| `RECAP_FROM_EMAIL` | `UNC Grudge Match <recap@planitnow.us>` |
| `RECAP_SITE_URL` | `https://grudge.planitnow.us` |

No ESPN cookies here — the weekly pipeline is unauthenticated by design, which is
the main reason the backfill is a separate one-time script. No Clerk secret here
either — the pipeline talks to Postgres directly and never touches Clerk.
Recap recipients come from active provisioned profiles; each member controls the
`recap_email_enabled` preference on `/me`.

---

## Task 4 — Vercel and the domain (~10 minutes, needed at Step 6)

Nothing to do yet; here so you can see the shape.

### 4a. Import
<https://vercel.com/new> → import `killjoy00/Grudge` → framework auto-detects
Next.js → **don't deploy yet**, add env vars first.

### 4b. Environment variables
**Settings → Environment Variables**, all three environments. The Clerk keys
are confirmed from Task 2. The owner and pipeline credentials never belong in
Vercel:

| name | scope |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production, Preview, Development |
| `CLERK_SECRET_KEY` | Production, Preview, Development |
| `APP_DATABASE_URL` (`app_user`) | Production, Preview, Development |
| `PROVISIONER_DATABASE_URL` (`app_provisioner`) | Production only |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Production only |

### 4c. Deploy hook
**Settings → Git → Deploy Hooks** → create one named `weekly-pipeline` on `main`
→ copy the URL into the `VERCEL_DEPLOY_HOOK_URL` secret from Task 3.

### 4d. Domain
**Settings → Domains** → add `grudge.planitnow.us`. Vercel will ask for one
record at your `planitnow.us` DNS host:

```
Type: CNAME    Name: grudge    Value: cname.vercel-dns.com
```

TLS is issued automatically once DNS resolves — usually minutes, up to an hour.
Then go back to **Clerk → Configure → Domains** and add it there too, so magic
links point at the right place.

---

## Quick reference — where each secret is allowed to live

| value | laptop `.env.local` | GitHub secret | Vercel | browser |
|---|:--:|:--:|:--:|:--:|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | — | ✅ | ✅ (that's what "publishable" means) |
| `CLERK_SECRET_KEY` | ✅ | — | ✅ | ❌ **never** |
| `DATABASE_URL` (admin/migrations) | ✅ | — | — | ❌ |
| `APP_DATABASE_URL` (`app_user`) | ✅ | ✅ CI only | ✅ | ❌ |
| `PIPELINE_DATABASE_URL` (`app_pipeline`) | — | ✅ | — | ❌ **never** — bypasses RLS entirely |
| `PROVISIONER_DATABASE_URL` (`app_provisioner`) | ✅ | — | ✅ prod only | ❌ |
| `CLERK_WEBHOOK_SIGNING_SECRET` | ✅ | — | ✅ prod only | ❌ |
| `RESEND_API_KEY` | ✅ | ✅ | — | ❌ |
| `ESPN_SWID` / `ESPN_S2` | ✅ backfill only | ❌ **never** | ❌ | ❌ |
