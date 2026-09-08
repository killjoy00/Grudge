"""Grudge scoring from archived ESPN rules, with explicit unsupported evidence.

Stat IDs: ESPN scoringItems / weekly appliedStats, independently checked against
https://github.com/cwendt94/espn-api/blob/master/espn_api/football/constant.py
The yardage buckets truncate toward zero (ESPN's negative-yard behavior).
"""
import math

VERSION = 'players-1.0'
POSITIONS = {'QB': 1, 'RB': 2, 'FB': 2, 'WR': 3, 'TE': 4, 'K': 5, 'D/ST': 16}


def number(row, key):
    value = row.get(key)
    return float(value) if value not in ('', None, 'NA', 'NaN') else 0


def score(row, items, position):
    """Return (points, unsupported active stat IDs), never silently ignore a rule."""
    n = lambda key: number(row, key)
    values = {
        3: n('passing_yards'), 4: n('passing_tds'),
        5: math.trunc(n('passing_yards') / 5),
        8: math.trunc(n('passing_yards') / 25),
        10: math.trunc(n('passing_yards') / 100),
        15: n('passing_td_40'), 19: n('passing_2pt_conversions'),
        20: n('passing_interceptions'), 24: n('rushing_yards'),
        25: n('rushing_tds'), 26: n('rushing_2pt_conversions'),
        28: math.trunc(n('rushing_yards') / 10), 35: n('rushing_td_40'),
        42: n('receiving_yards'), 43: n('receiving_tds'),
        44: n('receiving_2pt_conversions'), 45: n('receiving_td_40'),
        48: math.trunc(n('receiving_yards') / 10), 53: n('receptions'),
        63: n('offensive_fumble_recovery_tds'), 72: n('fumbles_lost_total'),
        74: n('fg_made_50_59') + n('fg_made_60_'),
        77: n('fg_made_40_49'),
        80: n('fg_made_0_19') + n('fg_made_20_29') + n('fg_made_30_39'),
        # Blocked attempts count as missed field goals in ESPN's distance band.
        82: n('fg_missed_0_19') + n('fg_missed_20_29') + n('fg_missed_30_39') + n('fg_blocked_under_40'),
        86: n('pat_made'), 198: n('fg_made_50_59'), 201: n('fg_made_60_'),
        93: n('blocked_kick_tds'), 95: n('def_interceptions'),
        96: n('def_fumbles'), 97: n('def_punt_blocks') + n('def_pat_blocks') + n('def_fg_blocks'),
        98: n('def_safeties'), 99: n('def_sacks'),
        101: n('kickoff_return_tds'), 102: n('punt_return_tds'),
        103: n('interception_return_tds'), 104: n('fumble_return_tds'),
    }
    for stat, low, high in [(89, 0, 0), (90, 1, 6), (91, 7, 13), (92, 14, 17),
                            (121, 18, 21), (122, 22, 27), (123, 28, 34), (124, 35, 45), (125, 46, 200)]:
        values[stat] = int(position == 16 and low <= n('def_points_allowed') <= high)
    rates = {i['statId']: i.get('pointsOverrides', {}).get(str(position), i['points']) for i in items}
    unsupported = sorted(stat for stat, rate in rates.items() if rate and stat not in values)
    if unsupported:
        return None, unsupported
    # Defensive stats in a team aggregate must never include its offense's yards,
    # kicks or turnovers. The caller supplies a defensive-only row for D/ST.
    return round(sum(values.get(stat, 0) * rate for stat, rate in rates.items()), 4), []
