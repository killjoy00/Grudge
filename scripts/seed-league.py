#!/usr/bin/env python3
"""
Generate SQL to seed the league's reference data from the Step 1 ESPN capture.

Emits idempotent upserts for seasons, members, teams, team_owners and
lineup_slots, then the league_allowlist rows. Reads exploration/raw/, so it
depends on nothing live and can be re-run safely.

  python3 scripts/seed-league.py > /tmp/seed.sql
  NEON_URL=... node scripts/neon-sql.mjs /tmp/seed.sql

is_starter is DERIVED from settings.rosterSettings.lineupSlotCounts rather than
hardcoded -- a slot is a starter iff its count > 0 and it is not bench (20) or
IR (21). Hardcoding it would silently corrupt optimal-lineup maths if the
league ever changes its roster settings.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / 'exploration' / 'raw'

team = json.loads((RAW / '2026_mTeam.json').read_text())
settings = json.loads((RAW / '2026_mSettings.json').read_text())['settings']


def q(s):
    return "'" + str(s).replace("'", "''") + "'" if s is not None else 'null'


out = []
sc = settings['scheduleSettings']
acq = settings['acquisitionSettings']
out.append(f"""insert into public.seasons
 (season, league_name, team_count, regular_season_weeks, playoff_team_count,
  final_scoring_period, faab_budget, playoff_seeding_rule, is_current, settings_raw)
values (2026, {q(settings['name'])}, {settings['size']}, {sc['matchupPeriodCount']},
 {sc['playoffTeamCount']}, 17, {acq['acquisitionBudget']}, {q(sc['playoffSeedingRule'])},
 true, {q(json.dumps(settings))}::jsonb)
on conflict (season) do update set
 league_name=excluded.league_name, settings_raw=excluded.settings_raw;""")

for m in team['members']:
    out.append(f"""insert into public.members (season, swid, display_name, first_name, last_name)
values (2026, {q(m['id'])}, {q(m.get('displayName'))}, {q(m.get('firstName'))}, {q(m.get('lastName'))})
on conflict (season, swid) do update set display_name=excluded.display_name;""")

for t in team['teams']:
    tc = t.get('transactionCounter') or {}
    out.append(f"""insert into public.teams
 (season, espn_team_id, name, abbrev, logo_url, division_id, primary_owner_swid, waiver_rank, faab_spent)
values (2026, {t['id']}, {q(t['name'])}, {q(t.get('abbrev'))}, {q(t.get('logo'))},
 {t.get('divisionId', 0)}, {q(t.get('primaryOwner'))}, {t.get('waiverRank') or 'null'},
 {tc.get('acquisitionBudgetSpent', 0)})
on conflict (season, espn_team_id) do update set
 name=excluded.name, faab_spent=excluded.faab_spent;""")
    for o in t.get('owners', []):
        prim = 'true' if o == t.get('primaryOwner') else 'false'
        out.append(f"""insert into public.team_owners (season, espn_team_id, swid, is_primary)
values (2026, {t['id']}, {q(o)}, {prim}) on conflict do nothing;""")

counts = settings['rosterSettings']['lineupSlotCounts']
labels = {0: 'QB', 2: 'RB', 4: 'WR', 5: 'WR/TE', 6: 'TE',
          16: 'D/ST', 17: 'K', 20: 'BE', 21: 'IR', 23: 'FLEX'}
for sid, cnt in counts.items():
    sid = int(sid)
    if cnt == 0 and sid not in (20, 21):
        continue
    starter = 'true' if (cnt > 0 and sid not in (20, 21)) else 'false'
    out.append(f"""insert into public.lineup_slots (season, lineup_slot_id, slot_count, is_starter, label)
values (2026, {sid}, {cnt}, {starter}, {q(labels.get(sid))})
on conflict (season, lineup_slot_id) do update set
 slot_count=excluded.slot_count, is_starter=excluded.is_starter;""")

# Supplied by the league admin. THREE MEMBERS STILL HAVE NO EMAIL:
# Ryan Mindell (team 1), byron lafleur (team 1), Jason Campbell (team 10).
# No is_admin is set yet -- pending confirmation of who administers the site.
ALLOWLIST = [
    ('sammynye@gmail.com',      6,  False),
    ('bwildfire@gmail.com',     5,  False),
    ('jwildfire@gmail.com',     5,  False),
    ('camero.gary@gmail.com',   11, False),
    ('jamarks80@gmail.com',     9,  False),
    ('hannanath@gmail.com',     2,  False),
    ('josephpresley@gmail.com', 3,  False),
    ('jcrisp@gmail.com',        8,  False),
    ('uncpenguin@gmail.com',    4,  False),
    ('jordanchin@gmail.com',    10, False),
]
for email, tid, admin in ALLOWLIST:
    out.append(f"""insert into public.league_allowlist (email, espn_team_id, season, is_admin)
values ({q(email)}, {tid}, 2026, {str(admin).lower()})
on conflict (email) do update set espn_team_id=excluded.espn_team_id;""")

print('\n'.join(out))
