import test from 'node:test';
import { execFileSync } from 'node:child_process';
test('season scoring and play-by-play reconstruction', () => {
  execFileSync('python3', ['-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_player_scoring.py'], {stdio: 'pipe'});
});
