# Ranking and trade-model audit

Reviewed against the checked-in league history through the 2025 season.

## Power rankings

The current 40/30/20/10 blend was compared with four common alternatives at
every regular-season week from week 3 onward in 2018, 2019 and 2021–2025:

| model | next-matchup accuracy | rank correlation with remaining-season scoring |
|---|---:|---:|
| current all-play / PPG / record / schedule blend | 54.1% (203/375) | 0.299 |
| points per game only | 52.0% | **0.341** |
| all-play only | 52.8% | 0.278 |
| standardized 60% PPG / 25% all-play / 15% record | **55.5%** | 0.320 |
| season PPG plus four-week recent form | 51.7% | 0.314 |

The apparent win for the standardized blend was not stable under
leave-one-season-out checks: its held-out advantage reversed in multiple
seasons, while recency made the matchup result materially worse. Points per
game best anticipates future scoring, but that is only one of the ranking's
stated goals; it deliberately also describes schedule-neutral results and
actual wins. Pythagorean expectation was considered but adds little here:
points against is mostly schedule noise in head-to-head fantasy, while all-play
already compares every score with the league in the same scoring environment.
An Elo-style rating was also rejected for this surface because matchup order
and opponent identity add noise to a game whose team scores are the stronger
signal.

**Decision:** retain 40/30/20/10. The small in-sample gain from retuning seven
seasons is not enough evidence for a version change, and the existing model is
the more transparent description of its four declared concepts. Revisit after
several more seasons or validate against a larger multi-league dataset.

## Draft grades

The former grade subtracted production rank from draft rank *within position*.
That had two structural problems:

1. A first-at-position QB selected 50th was charged like a first-at-position RB
   selected first overall, even though the draft capital was radically
   different.
2. A deep position could create a much larger positive or negative range than
   a shallow position. A 50-player WR pool could dominate a 10-player TE pool
   solely because its rank numbers were larger.

The replacement model scores both inputs on a bounded 0–100 scale:

- **production score:** season finish percentile among players at the same
  position, preserving position adjustment;
- **draft-capital score:** overall-pick percentile across that draft, charging
  what the manager actually spent;
- **draft value:** production score minus draft-capital score.

This makes a late positional star a steal, an early non-producer a bust, and
every position comparable. Class and draft-slot ratings use the average of the
same pick-level value, so their tables cannot disagree with the individual-pick
ranking. Zero-production ties remain at the bottom percentile instead of being
arbitrarily ordered.

## Trade ratings

The two trade ratings answer usefully different questions and should remain
separate:

- **Team fit** uses the exact legal best-lineup counterfactual. It correctly
  avoids summing bench depth at full value and can show a mutually beneficial
  positional trade.
- **Player value** totals acquired offensive-player production above the same
  position-specific replacement baselines while the acquiring team owns each
  player. It intentionally answers who received the better production,
  independent of that roster's lineup blockage.

Two data-integrity issues were corrected without changing those definitions:

1. A trade containing only players with unknown lineup eligibility is now
   ungraded rather than displayed as an authoritative tie.
2. A player appearing under both owners in a transaction-week snapshot is
   collapsed to one player-week before PPG, replacement level and historical
   trade points are calculated. The starting flag is retained if either edge
   records it, and the score is counted once.

Kickers and defenses remain excluded, and missing completed weeks still produce
no verdict rather than a tie.
