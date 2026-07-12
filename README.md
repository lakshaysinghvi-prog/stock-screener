# Daily Stock Screener

Fetches free/public market data (Yahoo Finance) for a watchlist, scores each stock on
technical (RSI, moving averages, volume) and fundamental (P/E, debt/equity, earnings
growth) strength, and writes the top 5 into your Airtable dashboard once a day.

This is a research/screening tool. It does not generate trade recommendations,
entry/exit prices, or stop-losses — treat scores and notes as inputs to your own analysis.

## One-time setup

1. **Add the Airtable secret**: Repo → Settings → Secrets and variables → Actions →
   "New repository secret" → name it `AIRTABLE_TOKEN`, paste a Personal Access Token
   from https://airtable.com/create/tokens with `data.records:write` scope on the
   "Daily Stock Screener" base.
2. That's it — the workflow in `.github/workflows/daily-screener.yml` is already
   scheduled for 8:30 AM IST, weekdays.

## Customizing

- Edit the `watchlist` array in `scripts/screener.js` to change which stocks get screened.
- Edit the `cron` line in the workflow file to change the schedule.
- Run it on demand anytime: Actions tab → "Daily Stock Screener" → "Run workflow".

## Notes

- Yahoo Finance's API is free but unofficial — it can occasionally rate-limit or change
  shape. If a run fails, check the Actions log first.
- GitHub Actions free tier includes generous minutes for public repos, and a monthly
  free allowance for private repos too — this job runs in well under a minute a day.
