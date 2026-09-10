#!/usr/bin/env python3
"""Build complete, ownership-independent draft production through the Grudge regular season.

ESPN weekly scores are preferred. Missing weeks and the legacy era are rebuilt
from nflverse using each season's archived scoring settings. The three 40+ yard
TD bonus flags are not in nflverse weekly aggregates; reconstructed rows remain
explicitly labeled estimates. No missing identity is silently converted to zero.
"""
import argparse
import csv
import gzip
import hashlib
import json
import math
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
POSITIONS = {'QB': 1, 'RB': 2, 'FB': 2, 'WR': 3, 'TE': 4}
ID_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
STATS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{}.csv'


def csv_rows(path):
    with path.open() as file:
        return list(csv.DictReader(file))


def league(path):
    with gzip.open(path) as file:
        value = json.load(file)
    return value[0] if isinstance(value, list) else value


def normalized(name):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', name.lower()))


def score(row, scoring_items, position):
    def number(key):
        value = row.get(key, '')
        return float(value) if value not in ('', None, 'NA') else 0
    stats = {
        3: number('passing_yards'), 4: number('passing_tds'),
        5: math.floor(number('passing_yards') / 5),
        8: math.floor(number('passing_yards') / 25),
        10: math.floor(number('passing_yards') / 100),
        19: number('passing_2pt_conversions'), 20: number('passing_interceptions'),
        24: number('rushing_yards'), 25: number('rushing_tds'),
        26: number('rushing_2pt_conversions'), 28: math.floor(number('rushing_yards') / 10),
        42: number('receiving_yards'), 43: number('receiving_tds'),
        44: number('receiving_2pt_conversions'), 48: math.floor(number('receiving_yards') / 10),
        53: number('receptions'), 63: number('fumble_recovery_tds'),
        72: number('fumbles_lost_total'),
    }
    total = sum(stats.get(item['statId'], 0) * item.get('pointsOverrides', {}).get(str(position), item['points'])
                for item in scoring_items)
    # ESPN uses separate kick/punt-return TD fields; nflverse aggregates both.
    rates = {item['statId']: item.get('pointsOverrides', {}).get(str(position), item['points']) for item in scoring_items}
    if rates.get(101, 0) != rates.get(102, 0):
        raise ValueError('Cannot combine differing kickoff/punt-return touchdown rates')
    return round(total + number('special_teams_tds') * rates.get(101, 0), 4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=pathlib.Path, default=pathlib.Path('/tmp/grudge-draft-sources'))
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    sources = []

    def source(filename, url):
        path = args.cache_dir / filename
        if not path.exists():
            if args.offline:
                raise ValueError(f'Missing cached source {filename}')
            temp = path.with_suffix('.download')
            subprocess.run(['curl', '-fsSL', '--retry', '2', '--max-time', '90', url, '-o', str(temp)], check=True)
            temp.replace(path)
        sources.append({'url': url, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        return csv_rows(path)

    crosswalk = source('playerids.csv', ID_URL)
    by_espn = {}
    for row in crosswalk:
        if row['espn_id'].isdigit():
            by_espn[int(row['espn_id'])] = row
    overrides = ROOT / 'data/draft-player-identities.json'
    for row in json.loads(overrides.read_text())['players']:
        by_espn[row['espn_id']] = row
    excluded_overrides_path = ROOT / 'data/draft-excluded-pick-overrides.json'
    excluded_data = json.loads(excluded_overrides_path.read_text())
    if excluded_data.get('schema_version') != 1:
        raise ValueError('Unsupported excluded draft-pick override schema')
    excluded_overrides = {(row['season'], row['overall_pick']): row for row in excluded_data.get('excluded_picks', [])}
    if len(excluded_overrides) != len(excluded_data.get('excluded_picks', [])):
        raise ValueError('Duplicate excluded draft-pick override')
    archives = {}
    metadata = {}
    for directory in ['history', 'seasons']:
        for file in sorted((ROOT / 'data' / directory).glob('*/league.json.gz')):
            year = int(file.parent.name)
            data = league(file)
            archives[year] = (file.parent, data)
            for team in data.get('teams', []):
                for entry in team.get('roster', {}).get('entries', []):
                    player = (entry.get('playerPoolEntry') or {}).get('player', {})
                    if player.get('id'):
                        metadata[player['id']] = player

    seasons = []
    score_seasons = []
    all_identities = {}
    checks = []
    skipped_boards = []
    archive_sources = []
    unresolved = []
    for year, (directory, data) in sorted(archives.items()):
        if year < 2005 or year == 2020:
            continue
        raw_picks = [p for p in data.get('draftDetail', {}).get('picks', [])
                     if p.get('teamId', 0) > 0 and p.get('overallPickNumber')]
        picks = [p for p in raw_picks if p.get('playerId')]
        regular = data['settings']['scheduleSettings']['matchupPeriodCount']
        completed = {w for w in range(1, regular + 1)
                     if len([m for m in data.get('schedule', []) if m['matchupPeriodId'] == w
                             and m.get('winner') in ('HOME', 'AWAY', 'TIE') and m.get('home') and m.get('away')])
                     == len(data['teams']) // 2}
        if not raw_picks or not set(range(1, regular + 1)).issubset(completed):
            continue
        max_pick = max(p['overallPickNumber'] for p in raw_picks)
        present_picks = {p['overallPickNumber'] for p in raw_picks}
        missing_picks = sorted(set(range(1, max_pick + 1)) - present_picks)
        excluded_board = []
        unresolved_zero_picks = []
        used_overrides = set()
        for pick in raw_picks:
            if pick.get('playerId'):
                continue
            key = (year, pick['overallPickNumber'])
            override = excluded_overrides.get(key)
            if pick.get('lineupSlotId') == 16:
                excluded_board.append({'overall_pick': pick['overallPickNumber'], 'espn_team_id': pick['teamId'],
                                       'position': 'DST', 'evidence': 'espn_lineup_slot_16'})
            elif override and override.get('position') == 'DST':
                used_overrides.add(key)
                excluded_board.append({'overall_pick': pick['overallPickNumber'], 'espn_team_id': pick['teamId'],
                                       'position': 'DST', 'evidence': override.get('evidence', 'manual_review')})
            else:
                unresolved_zero_picks.append(pick['overallPickNumber'])
        unused_overrides = sorted(pick for pick in excluded_overrides if pick[0] == year and pick not in used_overrides)
        if unused_overrides:
            raise ValueError(f'{year}: excluded draft-pick overrides do not match zero-ID source rows: {unused_overrides}')
        if missing_picks or unresolved_zero_picks:
            skipped_boards.append({'season': year, 'recorded_picks': len(picks),
                                   'raw_pick_slots': len(raw_picks), 'max_overall_pick': max_pick,
                                   'missing_overall_picks': missing_picks,
                                   'excluded_pick_slots': [p['overall_pick'] for p in excluded_board],
                                   'unresolved_zero_player_picks': unresolved_zero_picks})
            blocked = sorted(set(missing_picks + unresolved_zero_picks))
            print(f'{year}: skipped incomplete draft evidence; unresolved overall picks {blocked}', flush=True)
            continue
        rows = source(f'{year}.csv', STATS_URL.format(year))
        if len(rows) < 1000 or max(int(r['week']) for r in rows if r['season_type'] == 'REG') < regular:
            raise ValueError(f'{year}: incomplete NFL source')
        settings = data['settings']['scoringSettings']['scoringItems']
        archive_sources.append({'path': str((directory / 'league.json.gz').relative_to(ROOT)),
                                'sha256': hashlib.sha256((directory / 'league.json.gz').read_bytes()).hexdigest()})
        scoring_hash = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()
        for week in range(1, regular + 1):
            if sum(r['season_type'] == 'REG' and int(r['week']) == week for r in rows) < 300:
                raise ValueError(f'{year} week {week}: incomplete NFL week')
        exact = {}
        season_meta = {}
        for file in sorted((directory / 'boxscores').glob('sp*.json.gz')):
            week = int(file.name[2:4])
            if week > regular:
                continue
            archive_sources.append({'path': str(file.relative_to(ROOT)),
                                    'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
            for match in league(file).get('schedule', []):
                if match['matchupPeriodId'] != week:
                    continue
                for side in [match.get('home'), match.get('away')]:
                    if not side:
                        continue
                    for entry in side.get('rosterForCurrentScoringPeriod', {}).get('entries', []):
                        pool_entry = entry.get('playerPoolEntry') or {}
                        player = pool_entry.get('player', {})
                        if not player.get('id'):
                            continue
                        season_meta.setdefault(player['id'], player)
                        value = pool_entry.get('appliedStatTotal')
                        if value is not None:
                            key = (player['id'], week)
                            if key in exact and abs(exact[key] - value) > 0.01:
                                raise ValueError(f'{year}: conflicting ESPN player-week {key}')
                            exact[key] = value

        weekly = {}
        names = {}
        pool_meta = {}
        for row in rows:
            pos = POSITIONS.get(row['position'])
            if row['season_type'] != 'REG' or not pos:
                continue
            gsis = row['player_id']
            pool_meta[gsis] = {'position': pos, 'name': row['player_display_name']}
            names.setdefault((normalized(row['player_display_name']), pos), set()).add(gsis)
            if int(row['week']) <= regular:
                key = (gsis, int(row['week']))
                if key in weekly:
                    raise ValueError(f'{year}: duplicate NFL player-week {key}')
                weekly[key] = score(row, settings, pos)
        id_map = {}
        for player_id, info in by_espn.items():
            if info['gsis_id'] not in ('NA', ''):
                id_map[player_id] = info['gsis_id']

        def resolve(player_id, name, pos):
            gsis = id_map.get(player_id)
            if gsis:
                return gsis
            matches = names.get((normalized(name), pos), set())
            return next(iter(matches)) if len(matches) == 1 else None

        # Validate reconstruction against independent archived weekly scores.
        errors = []
        for (player_id, week), points in exact.items():
            info = season_meta[player_id]
            pos = info.get('defaultPositionId')
            if pos not in (1, 2, 3, 4):
                continue
            gsis = resolve(player_id, info.get('fullName', ''), pos)
            if (gsis, week) in weekly:
                errors.append(abs(weekly[(gsis, week)] - points))
            if gsis:
                pool_meta[gsis] = {'position': pos, 'name': info.get('fullName', '')}

        # Merge exact scores across ALL fantasy owners, then fill NFL weeks even
        # when nobody rostered the player. A bye/no-stat week is a verified zero
        # only after the player's NFL identity has been established.
        exact_by_gsis = {}
        for (player_id, week), points in exact.items():
            info = season_meta[player_id]
            pos = info.get('defaultPositionId')
            gsis = resolve(player_id, info.get('fullName', ''), pos)
            if gsis and pos in (1, 2, 3, 4):
                exact_by_gsis[(gsis, week)] = points
        merged = {**weekly, **exact_by_gsis}
        pool = [[gsis, info['position'], round(sum(merged.get((gsis, w), 0) for w in range(1, regular + 1)), 2)]
                for gsis, info in sorted(pool_meta.items())]
        results = []
        for pick in picks:
            player_id = pick['playerId']
            info = season_meta.get(player_id) or metadata.get(player_id) or {}
            crossed = by_espn.get(player_id, {})
            pos = info.get('defaultPositionId') or POSITIONS.get(crossed.get('position'))
            if pos in (5, 16) or player_id < 0 or crossed.get('position') in ('K', 'PK', 'DST', 'DEF'):
                continue
            name = info.get('fullName') or crossed.get('name') or f'Player {player_id}'
            gsis = resolve(player_id, name, pos)
            if pos not in (1, 2, 3, 4) or not gsis:
                unresolved.append((year, player_id, name))
                continue
            # A current player record can have a different career position.
            # Prefer this season's ESPN metadata, then the historical NFL file.
            if player_id not in season_meta and gsis in pool_meta:
                pos = pool_meta[gsis]['position']
            values = [exact.get((player_id, w), merged.get((gsis, w), 0)) for w in range(1, regular + 1)]
            reconstructed = sum(1 for w in range(1, regular + 1)
                                if (gsis, w) in weekly and (player_id, w) not in exact)
            source_label = 'espn_weekly' if not reconstructed and any((player_id, w) in exact for w in range(1, regular + 1)) \
                else 'no_regular_season_stats' if gsis not in pool_meta else 'nflverse' if not exact else 'espn_nflverse'
            results.append({'overall_pick': pick['overallPickNumber'], 'espn_team_id': pick['teamId'],
                            'espn_player_id': player_id, 'full_name': name, 'position': pos,
                            'fantasy_points': round(sum(values), 2),
                            'active_weeks': sum(v != 0 for v in values), 'performance_source': source_label})
            # Include identified drafted players who recorded no NFL stats at all.
            pool_meta.setdefault(gsis, {'position': pos, 'name': name})
            id_map[player_id] = gsis
        if errors and sum(errors) / len(errors) > 1:
            raise ValueError(f'{year}: reconstruction disagrees with ESPN by more than 1 point per player-week')
        checks.append({'season': year, 'graded_picks': len(results), 'verified_player_weeks': len(errors),
                       'mean_absolute_error': round(sum(errors) / len(errors), 4) if errors else None,
                       'max_absolute_error': round(max(errors), 4) if errors else None})
        seasons.append({'season': year, 'regular_weeks': regular, 'team_count': len(data['teams']),
                        'total_picks': max_pick,
                        'board': [[p['overallPickNumber'], p['teamId'], p['playerId']] for p in picks],
                        'excluded_board': excluded_board,
                        'slot_counts': data['settings']['rosterSettings']['lineupSlotCounts'],
                        'pool': pool, 'picks': results})
        espn_by_gsis = {gsis: player_id for player_id, gsis in id_map.items()}
        score_rows = []
        for gsis, info in sorted(pool_meta.items()):
            for week in range(1, regular + 1):
                key = (gsis, week)
                points = merged.get(key, 0)
                evidence = 'observed' if key in exact_by_gsis else 'reconstructed' if key in weekly else 'verified_zero'
                score_rows.append([gsis, espn_by_gsis.get(gsis), info['position'], week, points, evidence])
        score_seasons.append({'season': year, 'regular_weeks': regular, 'scoring_hash': scoring_hash,
                             'rows': score_rows})
        all_identities.update(id_map)
        print(f'{year}: {len(results)} offensive picks, {len(pool)} NFL players, {len(errors)} scoring comparisons', flush=True)
    if unresolved:
        raise ValueError(f'Unresolved draft identities; no output written: {unresolved}')
    output = ROOT / 'data/derived/draft-performance.json'
    output.write_text(json.dumps({'schema_version': 1, 'horizon': 'grudge_regular_season', 'seasons': seasons}, separators=(',', ':')) + '\n')
    (output.parent / 'draft-performance-provenance.json').write_text(json.dumps({
        'sources': sources, 'archives': archive_sources, 'checks': checks,
        'skipped_incomplete_boards': skipped_boards,
        'identity_overrides_sha256': hashlib.sha256(overrides.read_bytes()).hexdigest(),
        'excluded_pick_overrides_sha256': hashlib.sha256(excluded_overrides_path.read_bytes()).hexdigest(),
        'limitation': 'NFL reconstruction omits the 40+ yard touchdown bonus flags; ESPN weekly scores override reconstructed points wherever available.',
    }, indent=2) + '\n')
    scoring = json.dumps({'schema_version': 1,
                          'columns': ['gsis_id', 'espn_player_id', 'position', 'week', 'points', 'evidence'],
                          'seasons': score_seasons}, separators=(',', ':')).encode()
    (output.parent / 'player-week-scores.json.gz').write_bytes(gzip.compress(scoring, mtime=0))
    identities = {str(player_id): gsis for player_id, gsis in sorted(all_identities.items())}
    (output.parent / 'player-identities.json').write_text(json.dumps(identities, separators=(',', ':')) + '\n')
    # Publish the manifest last. A partial multi-file rebuild cannot pass import.
    files = ['draft-performance.json', 'draft-performance-provenance.json',
             'player-week-scores.json.gz', 'player-identities.json']
    manifest = {'schema_version': 1, 'files': {name: hashlib.sha256((output.parent / name).read_bytes()).hexdigest()
                                             for name in files}}
    temp_manifest = output.parent / 'model-evidence-manifest.json.tmp'
    temp_manifest.write_text(json.dumps(manifest, indent=2) + '\n')
    temp_manifest.replace(output.parent / 'model-evidence-manifest.json')


if __name__ == '__main__':
    main()
