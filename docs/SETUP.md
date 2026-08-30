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

Then the real run — about 3 minutes, ~150 requests, deliberately rate-limited:

```bash
node scripts/backfill-history.mjs
```

It writes `data/history/{2018..2025}/` with `league.json`, 17 per-week
`boxscores/spNN.json`, and a `manifest.json` recording which URL shape answered
and any warnings. **Each season is staged and only promoted once every request
for it succeeded**, so a season that fails part-way leaves nothing behind and you
can never commit half a season. Re-running a season overwrites it wholesale.

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

> `--no-boxscores` cuts it to ~16 requests if you just want records and matchups.
> You'd lose historical optimal-lineup analysis. I'd take the full run.

---

## Task 2 — Supabase project (~15 minutes)

Do this now; it unblocks the schema.

### 2a. Create the project

1. <https://supabase.com/dashboard> → **New project**.
2. Name `grudge`, region **East US (North Virginia)** — closest to Vercel's
   default `iad1`, which keeps server-component queries fast.
3. Generate a database password and **put it in your password manager now.** It
   is shown once and you need it for direct `psql`/migration access.
4. Free plan. Wait ~2 minutes for provisioning.

### 2b. Collect four values

**Settings → API**:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **`anon` / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe in the browser;
  it is powerless without a session because every table has RLS)
- **`service_role` key** → `SUPABASE_SERVICE_ROLE_KEY`

> ⚠️ The service-role key **bypasses RLS entirely**. It is the whole security
> model. It goes in GitHub Actions secrets and server-only Next.js code. It must
> never appear in a `NEXT_PUBLIC_*` variable, a client component, or a commit. If
> it ever leaks, rotate it in Settings → API immediately.

**Settings → Database → Connection string → URI** → `SUPABASE_DB_URL`
(substitute the password from 2a). I'll use this to apply migrations.

Put them in `.env.local` (already gitignored):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
SUPABASE_DB_URL=postgresql://postgres:...@db.xxxxxxxx.supabase.co:5432/postgres
```

### 2c. Configure auth for magic links

**Authentication → Providers**: enable **Email**, and turn **"Confirm email"
ON** and **password auth OFF** — magic link only.

**Authentication → URL Configuration**:
- Site URL: `https://grudge.planitnow.us`
- Redirect URLs — add all three:
  ```
  https://grudge.planitnow.us/**
  https://*.vercel.app/**
  http://localhost:3000/**
  ```

### 2d. Custom SMTP — required, not optional

Supabase's built-in email sender is capped at a few messages per hour and is
documented as development-only. With 13 people logging in around Sunday kickoff
you will hit that cap and magic links will silently stop arriving. It also can't
send your Tuesday newsletter.

1. <https://resend.com> → sign up (free tier: 3,000 emails/month).
2. **Domains → Add Domain** → `planitnow.us`. Add the DKIM/SPF records it gives
   you to your DNS. Wait for **Verified**.
3. **API Keys** → create one → save as `RESEND_API_KEY`.
4. Back in Supabase: **Project Settings → Authentication → SMTP Settings** →
   **Enable Custom SMTP**:

   | field | value |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | your `RESEND_API_KEY` |
   | Sender email | `grudge@planitnow.us` |
   | Sender name | `UNC Grudge Match` |

5. **Authentication → Rate Limits** → raise "Emails per hour" to 30.

Verify: **Authentication → Users → Invite user**, send yourself one, confirm it
arrives from `grudge@planitnow.us`. If it lands in spam, your DKIM/SPF isn't
fully propagated yet.

### 2e. Send me the allowlist

The last thing blocking the schema. 13 rows — I have the SWIDs and names from
Step 1, so I only need email and team:

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
| `SUPABASE_URL` | 2b Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 2b service_role key |
| `RESEND_API_KEY` | 2d |
| `VERCEL_DEPLOY_HOOK_URL` | Task 4c |

No ESPN cookies here — the weekly pipeline is unauthenticated by design, which is
the main reason the backfill is a separate one-time script.

---

## Task 4 — Vercel and the domain (~10 minutes, needed at Step 6)

Nothing to do yet; here so you can see the shape.

### 4a. Import
<https://vercel.com/new> → import `killjoy00/Grudge` → framework auto-detects
Next.js → **don't deploy yet**, add env vars first.

### 4b. Environment variables
**Settings → Environment Variables**, all three environments:

| name | scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production only** |
| `RESEND_API_KEY` | Production only |

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
Then go back to **2c** and confirm the Supabase Site URL matches.

---

## Quick reference — where each secret is allowed to live

| value | laptop `.env.local` | GitHub secret | Vercel | browser |
|---|:--:|:--:|:--:|:--:|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | — | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ prod only | ❌ **never** |
| `SUPABASE_DB_URL` | ✅ | — | — | ❌ |
| `RESEND_API_KEY` | ✅ | ✅ | ✅ prod only | ❌ |
| `ESPN_SWID` / `ESPN_S2` | ✅ backfill only | ❌ **never** | ❌ | ❌ |
