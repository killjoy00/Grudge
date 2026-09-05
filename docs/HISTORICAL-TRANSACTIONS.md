# Historical ESPN transaction repair

The original 2018-2025 ESPN archive captured matchups, rosters, and boxscores correctly, but its season-wide `mTransactions2` request did not populate the historical waiver/free-agent ledger. Historical transactions need to be requested with a `scoringPeriodId`.

`npm run history:transactions` repairs only that missing data. It does **not** re-download or replace the existing matchup or boxscore history.

## What the repair does

For every archived season from 2018 through 2025 it:

1. Reads the existing `data/history/<season>/league.json.gz`.
2. Requests `mTransactions2` once for every scoring period using the authenticated ESPN history API.
3. Deduplicates transaction IDs across ESPN responses, preferring the later copy when ESPN repeats a transaction with an updated state.
4. Merges those transactions into the existing `league.json.gz`.
5. Stores the raw per-period responses under `data/history/<season>/transactions/spNN.json.gz`.
6. Records counts and the successful ESPN URL shape in `manifest.json`.

All network requests for a season finish before that season's archive is changed. If a fetch fails, the existing archive remains intact.

## Credentials

The repair needs the same two ESPN browser cookies as the original history capture:

- `SWID` — keep the surrounding `{}` braces.
- `espn_s2` — copy the complete value without decoding it.

These are credentials for the ESPN account. Keep them on the local machine; do not commit them, put them in GitHub Actions, or paste them into chat.

## Run the repair

From a current checkout of the repository, set the two environment variables and first run the no-write authentication probe:

```bash
npm run history:transactions -- --probe
```

Then run the repair:

```bash
npm run history:transactions
```

A successful run changes only the affected files under `data/history/2018` through `data/history/2025`.

Review the changes, commit them on a branch, and open a pull request. After that data PR is merged, run the GitHub Actions workflow **Import ESPN history** once. That workflow uses the existing `PIPELINE_DATABASE_URL` repository secret and executes the normal history importer against the committed archive, which populates `public.transactions`, transaction items, and any trade reconstruction that can now use the ledger.

## Future full recaptures

If the entire ESPN history archive ever needs to be rebuilt from scratch, use:

```bash
npm run history:backfill
```

That runs the original matchup/boxscore capture and immediately follows it with the transaction repair so a fresh archive cannot silently lose historical waivers again.
