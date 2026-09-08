import gzip
import importlib.util
import json
import pathlib
import tempfile
import unittest
from player_scoring import score

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('builder', ROOT / 'scripts/build-player-data.py')
builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)


def rules(year):
    path = next((ROOT / 'data').glob(f'*/{year}/league.json.gz'))
    data = json.loads(gzip.decompress(path.read_bytes()))
    data = data[0] if isinstance(data, list) else data
    return data['settings']['scoringSettings']['scoringItems']


class ScoringTests(unittest.TestCase):
    def test_historical_and_te_premium(self):
        row = dict(receptions=6, receiving_yards=100, receiving_tds=1, receiving_td_40=1)
        self.assertEqual(score(row, rules(2005), 4), (17, []))
        self.assertEqual(score(row, rules(2025), 4), (20, []))
        self.assertEqual(score(row, rules(2026), 4), (23, []))
        self.assertEqual(score(row, rules(2026), 3), (20, []))

    def test_passing_buckets_and_long_td(self):
        row = dict(passing_yards=299, passing_tds=2, passing_td_40=1, passing_interceptions=1)
        self.assertEqual(score(row, rules(2005), 1), (20, []))
        self.assertEqual(score(row, rules(2017), 1), (11.7, []))
        self.assertEqual(score(row, rules(2025), 1), (14.97, []))

    def test_kicks_and_defense(self):
        row = dict(fg_made_30_39=1, fg_made_40_49=1, fg_made_60_=1, pat_made=2, fg_blocked_under_40=1)
        self.assertEqual(score(row, rules(2005), 5), (13, []))
        self.assertEqual(score(row, rules(2025), 5), (13, []))
        defense = dict(def_points_allowed=13, def_sacks=3, def_interceptions=1, def_fumbles=2)
        self.assertEqual(score(defense, rules(2025), 16), (13, []))

    def test_unknown_rule_is_withheld(self):
        self.assertEqual(score({}, [{'statId':999,'points':1}], 1), (None,[999]))

    def test_pbp_requires_a_touchdown_for_long_play_bonus(self):
        import csv
        plays = [dict(game_id='2025_01_BUF_KC', game_date='2025-09-01', home_team='KC',away_team='BUF',home_score=7,away_score=7,
                      posteam='KC',defteam='BUF',passing_yards=50,receiving_yards=50,passer_player_id='qb',receiver_player_id='wr',
                      pass_touchdown=td, touchdown=td, td_team='KC', td_player_id='wr') for td in (0,1)]
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'plays.csv.gz'
            with gzip.open(path,'wt') as f:
                writer=csv.DictWriter(f,fieldnames=list(plays[0]));writer.writeheader();writer.writerows(plays)
            players, _, _, _ = builder.pbp_extras(path)
            self.assertEqual(players[('2025_01_BUF_KC','qb')]['passing_td_40'],1)
            self.assertEqual(players[('2025_01_BUF_KC','wr')]['receiving_td_40'],1)


if __name__ == '__main__': unittest.main()
