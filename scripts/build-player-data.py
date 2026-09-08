#!/usr/bin/env python3
"""Build reproducible, season-sharded player data. Raw provider files stay in cache.

Run --seasons 1999:2026 for a backfill, --refresh --seasons 2026 for daily updates.
Past seasons must include every regular-season week. Only a current season may
have no game feed. An HTTP error other than that explicit 404 aborts publication.
"""
import argparse
import collections
import csv
import datetime as dt
import gzip
import hashlib
import json
import math
import pathlib
import re
import subprocess
from player_scoring import POSITIONS, VERSION, number, score

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_URL = 'https://github.com/nflverse/nflverse-data/releases/download/'
TEAMS = {1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
         9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LA', 15: 'MIA', 16: 'MIN',
         17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
         25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'}
TEAM_NAMES = ['Falcons','Bills','Bears','Bengals','Browns','Cowboys','Broncos','Lions','Packers','Titans',
              'Colts','Chiefs','Raiders','Rams','Dolphins','Vikings','Patriots','Saints','Giants','Jets','Eagles',
              'Cardinals','Steelers','Chargers','49ers','Seahawks','Buccaneers','Commanders','Panthers','Jaguars','Ravens','Texans']
RELOCATED = {'OAK': 'LV', 'SD': 'LAC', 'STL': 'LA', 'LAR': 'LA', 'JAC': 'JAX'}
TEAM_IDS = {abbr: i for i, abbr in TEAMS.items()}
BIO_FIELDS = ['birth_date', 'height', 'weight', 'college_name', 'rookie_season', 'last_season',
              'draft_year', 'draft_round', 'draft_pick', 'draft_team', 'headshot']
IGNORE_STATS = {'season','week','player_id','player_name','player_display_name','position','position_group',
                'headshot_url','season_type','game_id','team','opponent_team','fantasy_points','fantasy_points_ppr'}
NAME_ALIASES = json.loads((ROOT / 'data/player-name-aliases.json').read_text())['aliases']
PBP_STATS = ['passing_td_40', 'rushing_td_40', 'receiving_td_40', 'kickoff_return_tds',
             'punt_return_tds', 'interception_return_tds', 'fumble_return_tds',
             'offensive_fumble_recovery_tds', 'blocked_kick_tds']


def canonical_team(abbr):
    return RELOCATED.get(abbr, abbr)


def normalized(name):
    name = next((canonical for alias, canonical in NAME_ALIASES.items() if alias.lower() == name.lower()), name)
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', name.lower()))


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def read_json(path):
    value = json.loads(gzip.decompress(path.read_bytes()))
    return value[0] if isinstance(value, list) else value


def rows(path):
    if path is None:
        return []
    with (gzip.open(path, 'rt') if path.suffix == '.gz' else path.open()) as file:
        yield from csv.DictReader(file)


def pbp_extras(path):
    """Touchdown-only bonuses and return attribution, not counts of long plays.

    Team PA removes opponent defensive TDs and safeties charged to the offense.
    The calculation remains marked reconstructed, with observed ESPN preferred.
    """
    players = collections.defaultdict(collections.Counter)
    teams = collections.defaultdict(collections.Counter)
    dates = {}
    games = set()
    for p in rows(path):
        game = p['game_id']; games.add(game); dates[game] = p.get('game_date')
        offense, defense = canonical_team(p['posteam']), canonical_team(p['defteam'])
        for side in ('home', 'away'):
            team = canonical_team(p[f'{side}_team'])
            other = 'away' if side == 'home' else 'home'
            teams[(game, team)]['total_opponent_points'] = number(p, f'{other}_score')
        if p.get('play_type') == 'no_play':
            continue
        if number(p, 'pass_touchdown') and number(p, 'passing_yards') >= 40:
            players[(game, p.get('passer_player_id'))]['passing_td_40'] += 1
        if number(p, 'pass_touchdown') and number(p, 'receiving_yards') >= 40:
            players[(game, p.get('receiver_player_id'))]['receiving_td_40'] += 1
        if number(p, 'rush_touchdown') and number(p, 'rushing_yards') >= 40:
            players[(game, p.get('rusher_player_id'))]['rushing_td_40'] += 1
        if number(p, 'touchdown'):
            td_team = canonical_team(p.get('td_team', ''))
            td_player = p.get('td_player_id')
            stat = None
            if number(p, 'kickoff_attempt'):
                stat = 'kickoff_return_tds'
            elif number(p, 'punt_attempt'):
                stat = 'blocked_kick_tds' if number(p, 'punt_blocked') else 'punt_return_tds'
            elif number(p, 'field_goal_attempt'):
                stat = 'blocked_kick_tds'
            elif number(p, 'interception'):
                stat = 'interception_return_tds'
            elif not number(p, 'pass_touchdown') and not number(p, 'rush_touchdown'):
                stat = 'fumble_return_tds' if td_team == defense else 'offensive_fumble_recovery_tds'
            if stat:
                players[(game, td_player)][stat] += 1
                teams[(game, td_team)][stat] += 1
            if td_team == defense and stat in ('interception_return_tds', 'fumble_return_tds'):
                teams[(game, offense)]['excluded_points'] += 6
        if number(p, 'safety') and not number(p, 'punt_attempt'):
            teams[(game, offense)]['excluded_points'] += 2
    for value in teams.values():
        value['def_points_allowed'] = value['total_opponent_points'] - value['excluded_points']
    return players, teams, dates, games


def archives():
    result = {}
    for base in ('history', 'seasons'):
        for path in sorted((ROOT / 'data' / base).glob('*/league.json.gz')):
            result[int(path.parent.name)] = (path.parent, read_json(path))
    return result


def espn_players(data):
    for team in data.get('teams', []):
        for entry in (team.get('roster') or {}).get('entries', []):
            p = (entry.get('playerPoolEntry') or {}).get('player')
            if p and p.get('fullName') and (p.get('id') is not None or entry.get('playerId') is not None):
                yield {**p, 'id': p.get('id', entry.get('playerId'))}
    for matchup in data.get('schedule', []):
        for side in ('home', 'away'):
            for entry in (matchup.get(side) or {}).get('rosterForCurrentScoringPeriod', {}).get('entries', []):
                p = (entry.get('playerPoolEntry') or {}).get('player')
                if p and p.get('fullName') and (p.get('id') is not None or entry.get('playerId') is not None):
                    yield {**p, 'id': p.get('id', entry.get('playerId'))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=pathlib.Path, default=pathlib.Path('/tmp/grudge-player-sources'))
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'data/derived/players')
    parser.add_argument('--seasons', default='1999:2026')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    today = dt.date.today(); current = today.year - int(today.month < 3)
    first, last = map(int, args.seasons.split(':')) if ':' in args.seasons else (int(args.seasons), int(args.seasons))
    if first < 1999 or last > current or first > last:
        raise ValueError('Invalid season range')
    args.cache_dir.mkdir(parents=True, exist_ok=True); args.output.mkdir(parents=True, exist_ok=True)

    def source(name, url, refresh=False, optional=False):
        path = args.cache_dir / name
        if not path.exists() or (refresh and args.refresh and not args.offline):
            if args.offline:
                if optional: return None
                raise ValueError(f'Missing cached source {name}')
            temp = path.with_suffix('.download')
            response = subprocess.run(['curl', '-sSL', '--retry', '2', '--max-time', '180', '-w', '%{http_code}', url, '-o', str(temp)], check=True, capture_output=True, text=True)
            if response.stdout == '404' and optional:
                temp.unlink(missing_ok=True)
                return None
            if response.stdout != '200':
                raise ValueError(f'Source failed: {name} HTTP {response.stdout}')
            temp.replace(path)
        return path

    master_path = source('players_master.csv', DATA_URL + 'players/players.csv', refresh=True)
    roster_path = source(f'roster_{current}.csv', DATA_URL + f'rosters/roster_{current}.csv', refresh=True)
    crossed_path = source('playerids.csv', 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv', refresh=True)
    catalog = {}; espn = {}; names = collections.defaultdict(set)
    master = {p['gsis_id']: p for p in rows(master_path) if p['gsis_id']}
    for p in master.values():
        if p['position'] not in POSITIONS or not p['gsis_id']:
            continue
        key = 'gsis:' + p['gsis_id']
        catalog[key] = dict(player_key=key, full_name=p['display_name'], position='RB' if p['position'] == 'FB' else p['position'],
                            bio={k: p[k] for k in BIO_FIELDS if p.get(k) not in ('', 'NA')})
        catalog[key]['bio']['aliases'] = [alias for alias, name in NAME_ALIASES.items() if normalized(name) == normalized(p['display_name'])]
        for field in ('display_name', 'football_name'):
            if p.get(field): names[normalized(p[field])].add(key)
        if p.get('espn_id', '').isdigit(): espn[int(p['espn_id'])] = key
    for p in rows(crossed_path):
        key = 'gsis:' + p.get('gsis_id', '')
        # Two-way players can have an NFL defensive position but a fantasy WR
        # identity. Require the provider crosswalk, not an inferred name match.
        if key not in catalog and p.get('position') in POSITIONS and p.get('gsis_id') in master:
            m = master[p['gsis_id']]
            catalog[key] = dict(player_key=key, full_name=m['display_name'], position=p['position'],
                                bio={k: m[k] for k in BIO_FIELDS if m.get(k) not in ('', 'NA')})
        if key in catalog and p.get('espn_id', '').isdigit():
            espn.setdefault(int(p['espn_id']), key)
            names[normalized(p.get('name', ''))].add(key)
    for p in json.loads((ROOT / 'data/draft-player-identities.json').read_text())['players']:
        if p.get('gsis_id'):
            espn[p['espn_id']] = 'gsis:' + p['gsis_id']
    for (team_id, abbr), name in zip(TEAMS.items(), TEAM_NAMES):
        key = f'dst:{team_id}'
        catalog[key] = dict(player_key=key, full_name=f'{name} D/ST', position='D/ST', bio={})
        espn[-16000-team_id] = key
    reverse_espn = {key: identifier for identifier, key in espn.items()}
    archive = archives()
    manifest_path = args.output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'schema_version': 1, 'seasons': {}}
    if manifest.get('schema_version') != 1: raise ValueError('Unknown manifest schema')
    # Registry is merged for incremental builds, but provider refresh wins.
    registry_path = args.output / 'registry.json.gz'
    if registry_path.exists():
        prior = read_json(registry_path)
        catalog = {**{p['player_key']: p for p in prior['players']}, **catalog}

    for year in range(first, last + 1):
        paths = []
        def seasonal(name, relative):
            url = DATA_URL + relative
            path = source(name, url, refresh=year >= current - 1, optional=year == current)
            if path: paths.append({'url': url, 'sha256': digest(path.read_bytes())})
            return path
        stat_path = seasonal(f'{year}.csv', f'stats_player/stats_player_week_{year}.csv')
        team_path = seasonal(f'team_{year}.csv', f'stats_team/stats_team_week_{year}.csv')
        play_path = seasonal(f'pbp_{year}.csv.gz', f'pbp/play_by_play_{year}.csv.gz')
        if stat_path and (not team_path or not play_path):
            raise ValueError(f'{year}: wait for all three NFL feeds before publishing')
        # A disappearing current feed cannot erase previously published games.
        if not stat_path and manifest['seasons'].get(str(year), {}).get('row_count', 0):
            raise ValueError(f'{year}: previously available games disappeared')
        extras, defense, dates, pbp_games = pbp_extras(play_path) if play_path else ({}, {}, {}, set())
        game_rows = []; season_players = {}; aliases = {}; metadata = {}; observed = collections.defaultdict(set)
        directory, league = archive.get(year, (None, {}))
        settings = (league.get('settings') or {}).get('scoringSettings', {}).get('scoringItems') if year >= 2005 else None
        if year >= 2005 and not settings:
            raise ValueError(f'{year}: no archived league rules; do not guess')
        if directory:
            paths.append({'path': str(directory.relative_to(ROOT) / 'league.json.gz'), 'sha256': digest((directory / 'league.json.gz').read_bytes())})
            for p in espn_players(league): metadata[p['id']] = p
            for path in sorted((directory / 'boxscores').glob('*.gz')):
                bx = read_json(path)
                paths.append({'path': str(path.relative_to(ROOT)), 'sha256': digest(path.read_bytes())})
                week = int(re.search(r'sp(\d+)', path.name)[1])
                # Completed raw weekly stat blocks only. Empty blocks and absent
                # games are not fabricated zero-stat NFL appearances.
                for p in espn_players(bx):
                    metadata[p['id']] = p
                    for stat in p.get('stats', []):
                        if stat.get('seasonId', year) == year and stat.get('statSourceId') == 0 and stat.get('statSplitTypeId') == 1 and stat.get('scoringPeriodId') == week and stat.get('stats') and stat.get('appliedTotal') is not None:
                            observed[(week, p['id'])].add(round(float(stat['appliedTotal']), 4))

        def season_player(key, position, team):
            p = season_players.setdefault(key, dict(season=year, player_key=key, position=position, teams=[]))
            if team and team not in p['teams']: p['teams'].append(team)

        for r in rows(stat_path):
            key = 'gsis:' + r['player_id']
            pos = 'RB' if r['position'] == 'FB' else r['position']
            if pos not in POSITIONS and key in catalog: pos = catalog[key]['position']
            if pos not in POSITIONS: continue
            if not r['player_id']: raise ValueError(f'{year}: NFL row without identity')
            catalog.setdefault(key, dict(player_key=key, full_name=r['player_display_name'], position=pos, bio={}))
            names[normalized(r['player_display_name'])].add(key)
            season_player(key, pos, r['team'])
            stats = {}
            for field, value in r.items():
                if field in IGNORE_STATS or value in ('', None, 'NA', 'NaN'): continue
                try:
                    numeric = float(value)
                    if math.isfinite(numeric): stats[field] = numeric
                except ValueError: continue  # Provider list columns are not additive stats.
            stats.update(dict.fromkeys(PBP_STATS, 0))
            stats.update(extras.get((r['game_id'], r['player_id']), {}))
            stats['fg_blocked_under_40'] = sum(float(v) < 40 for v in r.get('fg_blocked_list', '').split(';') if v)
            game_rows.append(dict(season=year, player_key=key, season_type=r['season_type'], week=int(r['week']),
                                  game_id=r['game_id'], team=r['team'], opponent=r['opponent_team'], stats=stats))
        for r in rows(team_path):
            # nflverse 1999 has one unassigned offensive clock-play aggregate.
            # It is not a D/ST unit. Any unattributed defensive production fails.
            if not r['team']:
                if any(number(r, k) for k in r if k.startswith('def_')):
                    raise ValueError(f'{year}: defensive production without a team')
                continue
            abbr = canonical_team(r['team']); team_id = TEAM_IDS[abbr]; key = f'dst:{team_id}'
            season_player(key, 'D/ST', r['team'])
            stats = {k: number(r, k) for k in r if k.startswith('def_') or k in ('punt_return_yards', 'kickoff_return_yards')}
            stats.update(dict.fromkeys(PBP_STATS, 0))
            stats.update(defense.get((r['game_id'], abbr), {}))
            stats['def_fumbles'] = number(r, 'fumble_recovery_opp')
            stats.pop('offensive_fumble_recovery_tds', None)
            # ESPN announced the exclusion of opposing defensive scores in May
            # 2017. The 2018 archive independently corroborates the new behavior.
            # https://www.youtube.com/watch?v=T9C8nPZEZiQ (ESPN, 2017-05-03)
            if year < 2017: stats['def_points_allowed'] = stats['total_opponent_points']
            # PBP's return categories are disjoint; team defense aggregates also
            # contain TDs, so do not add def_tds on top of those categories.
            game_rows.append(dict(season=year, player_key=key, season_type=r['season_type'], week=int(r['week']),
                                  game_id=r['game_id'], team=r['team'], opponent=r['opponent_team'], stats=stats))
        if year == current:
            for r in rows(roster_path):
                key = 'gsis:' + r['gsis_id']
                pos = 'RB' if r['position'] == 'FB' else r['position']
                if pos not in POSITIONS and key in catalog: pos = catalog[key]['position']
                if pos not in POSITIONS or not r['gsis_id']: continue
                catalog.setdefault(key, dict(player_key=key, full_name=r['full_name'], position=pos, bio={}))
                season_player(key, pos, r['team'])
                if r.get('espn_id', '').isdigit(): espn[int(r['espn_id'])] = key
            for team_id, abbr in TEAMS.items(): season_player(f'dst:{team_id}', 'D/ST', abbr)
        # Modern provider IDs are useful only when their season/name also agree.
        for identifier, key in espn.items():
            if year >= 2008 and key in season_players:
                aliases[identifier] = dict(season=year, espn_player_id=identifier, player_key=key, match_method='provider_id')
        for identifier, p in metadata.items():
            pos = next((k for k, v in POSITIONS.items() if v == p.get('defaultPositionId') and k != 'FB'), None)
            if not pos: continue
            key = None; method = 'archive_only'
            if pos == 'D/ST' and p.get('proTeamId') in TEAMS:
                key = f"dst:{p['proTeamId']}"; method = 'team_id'
            else:
                candidates = [k for k in names[normalized(p['fullName'])] if k in season_players and season_players[k]['position'] == pos]
                if len(candidates) > 1:
                    team = TEAMS.get(p.get('proTeamId'))
                    candidates = [k for k in candidates if team in map(canonical_team, season_players[k]['teams'])]
                direct = espn.get(identifier)
                if year >= 2008 and direct in candidates:
                    key = direct; method = 'provider_id_and_name'
                elif len(candidates) == 1:
                    key = candidates[0]; method = 'season_name_position'
                elif year >= 2008 and direct in catalog and normalized(catalog[direct]['full_name']) == normalized(p['fullName']):
                    key = direct; method = 'provider_id_and_name'
            if key is None:
                key = f'archive:{year}:{identifier}'
                catalog[key] = dict(player_key=key, full_name=p['fullName'], position=pos, bio={})
            aliases[identifier] = dict(season=year, espn_player_id=identifier, player_key=key, match_method=method)
            season_player(key, pos, '')
            # ESPN's fantasy position governs its position-specific scoring
            # overrides (e.g. Taysom Hill), even if the NFL labels him otherwise.
            season_players[key]['position'] = pos
        # Drafted players missing from final rosters still get modern aliases.
        for pick in (league.get('draftDetail') or {}).get('picks', []):
            identifier = pick.get('playerId'); key = espn.get(identifier)
            if year >= 2008 and key in catalog and identifier not in aliases:
                aliases[identifier] = dict(season=year, espn_player_id=identifier, player_key=key, match_method='provider_id')
                season_player(key, catalog[key]['position'], '')
        by_key = collections.defaultdict(list)
        for a in aliases.values(): by_key[a['player_key']].append(a['espn_player_id'])
        errors = collections.defaultdict(list); unsupported = set(); seen = set()
        for r in game_rows:
            identity = (r['season_type'], r['week'], r['player_key'])
            if identity in seen: raise ValueError(f'Duplicate player-week: {year} {identity}')
            seen.add(identity)
            if r['game_id'] not in pbp_games: raise ValueError(f'{year}: PBP missing game {r["game_id"]}')
            position = season_players[r['player_key']]['position']
            calc, unknown = score(r['stats'], settings, POSITIONS[position]) if settings else (None, [])
            unsupported.update(unknown)
            exact = set()
            if r['season_type'] == 'REG':
                for identifier in by_key[r['player_key']]: exact.update(observed.get((r['week'], identifier), set()))
            if len(exact) == 1:
                points = next(iter(exact)); evidence = 'observed'
                if calc is not None: errors[position].append(round(calc - points, 4))
            elif len(exact) > 1:
                points = None; evidence = 'conflict'
            else:
                points = calc; evidence = 'reconstructed' if calc is not None else ('not_applicable' if year < 2005 else 'unavailable')
            r.update(fantasy_points=points, calculated_points=calc, score_evidence=evidence)
        if unsupported: raise ValueError(f'{year}: unsupported active ESPN rules {sorted(unsupported)}')
        regular = sorted({r['week'] for r in game_rows if r['season_type'] == 'REG'})
        postseason = sorted({r['week'] for r in game_rows if r['season_type'] == 'POST'})
        expected = list(range(1, (18 if year >= 2021 else 17) + 1))
        if year < current and regular != expected: raise ValueError(f'{year}: incomplete regular season: {regular}')
        validation = {pos: dict(comparisons=len(e), exact=sum(abs(x) < .011 for x in e), mae=round(sum(abs(x) for x in e)/len(e), 4), max_error=max(map(abs, e))) for pos, e in errors.items()}
        # A wrong scoring rule must stop the batch. Isolated provider corrections
        # remain visible in validation and the exact ESPN value wins.
        if any(v['comparisons'] >= 25 and v['mae'] > .6 for v in validation.values()):
            raise ValueError(f'{year}: scoring validation failed: {validation}')
        snapshots = []
        for team in league.get('teams', []):
            for entry in (team.get('roster') or {}).get('entries', []):
                identifier = entry.get('playerId') or ((entry.get('playerPoolEntry') or {}).get('player') or {}).get('id')
                if identifier in aliases:
                    snapshots.append(dict(season=year, espn_team_id=team['id'], player_key=aliases[identifier]['player_key'], snapshot_kind='current' if year == current else 'final'))
        payload = dict(schema_version=1, model_version=VERSION, season=year, players=sorted(season_players.values(), key=lambda p: p['player_key']),
                       aliases=sorted(aliases.values(), key=lambda a: a['espn_player_id']), rosters=snapshots,
                       games=sorted(game_rows, key=lambda r: (r['week'], r['player_key'])), regular_weeks=regular, postseason_weeks=postseason,
                       status='complete' if year < current else ('in_progress' if regular else 'awaiting_games'),
                       scoring_items=settings, scoring_hash=digest(settings) if settings else None,
                       validation=validation, sources=paths)
        encoded = gzip.compress(json.dumps(payload, separators=(',', ':'), allow_nan=False).encode(), mtime=0)
        (args.output / f'{year}.json.gz').write_bytes(encoded)
        manifest['seasons'][str(year)] = dict(file=f'{year}.json.gz', sha256=digest(encoded), row_count=len(game_rows), status=payload['status'])
        print(f'{year}: {len(season_players)} players, {len(game_rows)} games, {sum(a["match_method"]=="archive_only" for a in aliases.values())} unresolved archive identities; {json.dumps(validation)}', flush=True)
    registry = dict(schema_version=1, players=sorted(catalog.values(), key=lambda p: p['player_key']),
                    sources=[{'name': p.name, 'sha256': digest(p.read_bytes())} for p in (master_path, roster_path, crossed_path)])
    encoded = gzip.compress(json.dumps(registry, separators=(',', ':')).encode(), mtime=0)
    registry_path.write_bytes(encoded); manifest['registry_sha256'] = digest(encoded)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
