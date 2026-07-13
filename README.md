# Daily Stock Screener

Fetches free/public market data (Yahoo Finance) for a ~150-stock universe (NIFTY 100 +
a supplementary set of other liquid BSE 100 names), scores each stock on technical
(RSI, moving averages, volume) and fundamental (P/E, debt/equity, earnings growth)
strength, and writes the top 50 into your Airtable dashboard once a day.

This is a research/screening tool. The "Entry Zone" / "Suggested Stop Loss" fields are
a mechanical, rule-based read of the moving averages (e.g. "pullback toward the 50DMA
in an uptrend") — not personalized investment advice. Treat all scores and notes as
inputs to your own analysis.

## One-time setup

1. **Add the Airtable secret**: Repo → Settings → Secrets and variables → Actions →
   "New repository secret" → name it `AIRTABLE_TOKEN`, paste a Personal Access Token
   from https://airtable.com/create/tokens with `data.records:write` scope on the
   "Daily Stock Screener" base.
2. **Add 4 new columns** to the Airtable table (Airtable's API can't create fields on
   its own): `Entry Zone Low` (Number), `Entry Zone High` (Number), `Suggested Stop Loss`
   (Number), `Entry Notes` (Long text). Without these the run will fail on the write step.
3. That's it — the workflow in `.github/workflows/daily-screener.yml` is already
   scheduled for 8:30 AM IST, weekdays.

## Customizing

- Edit the `watchlist` array in `scripts/screener.js` to change which stocks get screened.
- Edit `TOP_N` in `scripts/screener.js` to change how many ranked stocks get written (default 50).
- Edit the `cron` line in the workflow file to change the schedule.
- Run it on demand anytime: Actions tab → "Daily Stock Screener" → "Run workflow".

## Notes

- Yahoo Finance's API is free but unofficial — it can occasionally rate-limit or change
  shape. If a run fails, check the Actions log first. Individual tickers that fail to
  fetch are skipped (logged as a warning) rather than failing the whole run.
- With ~150 tickers screened per run (2 Yahoo requests each, spaced out), expect the
  job to take a few minutes rather than seconds — still well within GitHub Actions'
  free-tier minutes.
