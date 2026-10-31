# ICT Trading Backtesting & Journal

A local-first trading journal and backtesting dashboard for ICT-style discretionary trades. Record historical trades from TradingView Bar Replay, define flexible multi-level Exit Plans, and let the app calculate targets, Final R, statistics, equity, drawdown, and plan comparisons.

No accounts, servers, or build step. Trades, templates, settings, and screenshots are stored in your browser's IndexedDB.

## Quick start

Serve the folder over HTTP (recommended for reliable IndexedDB behavior):

```bash
python -m http.server 8000
```

or

```bash
npx serve .
```

Open `http://localhost:8000`.

Opening `index.html` directly with `file://` may work in some browsers, but IndexedDB and storage limits are unreliable there. Use a local server.

## Core workflow

1. Click **+ New Trade** (or press `Ctrl/Cmd + N`).
2. Record Date, Session, Instrument, Direction, Setup, Entry, Stop Loss, and an Exit Plan.
3. Save while leaving the trade incomplete if the outcome is not known yet.
4. Later open the trade and use **Complete Trade** to add MFE, MAE, exit reason, and the remainder exit R when needed.
5. Final R, status, dashboard cards, equity curve, drawdown, and analytics update immediately.

Entry, SL, direction, risk distance, and target R values derive target prices. Target prices are never stored.

## Exit Plans and Final R

- An Exit Plan can have any number of levels. Every level has an allocation and a target in R.
- Allocations must total exactly 100% (small rounding tolerance).
- Levels hit are evaluated in ascending R order from MFE, with manual override support for paths that skipped a target.
- Final R is the weighted result of filled allocations. Unfilled allocation is closed at the remainder exit R.
- A manual Final R override wins over calculated values.
- A trade is completed when Final R can be determined; incomplete trades stay visible in the table but are excluded from statistics and the equity curve.
- Plan comparison separates **Recorded** results from **Simulated** results and shows trades excluded for insufficient path data.

## Main features

- Compact trade table with sticky `#`, Date, and Instrument columns, sorting, filtering, column visibility, virtualization, and inline editing.
- Flexible Exit Plans with reusable templates.
- Blind backtest mode that hides result fields while logging a trade.
- Dashboard: net R, win rate, profit factor, average R, expectancy, drawdown, streaks.
- Equity curve and drawdown chart.
- Analytics tabs: session, instrument, direction, setup, quality, MFE/MAE distributions, target-hit rates, and Exit Plan comparison.
- Screenshots stored separately from trades, downscaled/compressed, with upload, drag and drop, paste, preview, and removal.
- Notes, setup quality, HTF context, killzones, batches, and custom instrument/setup/session lists.
- Dark and light themes, responsive layout, keyboard shortcuts.
- Demo data (100 trades) that can be loaded and cleared independently.
- Delete confirmation with a 15-second Undo.
- JSON backup/restore and CSV export.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + N` | New trade |
| `Ctrl/Cmd + F` or `/` | Focus search |
| `Ctrl/Cmd + E` | Export JSON |
| `B` | Toggle blind mode |
| `Esc` | Close modal/popover |
| `Enter` | Commit inline edit (except Notes) |
| `Ctrl/Cmd + Enter` | Commit Notes inline edit |

## Data, import, and export

**Export JSON** backs up trades, Exit Plans, templates, settings, custom lists, thresholds, and screenshots. The export includes `formatVersion: 1`.

**Export CSV** exports the current trade table. Exit Plans are written as readable strings such as `50%@2R / 50%@4R`.

**Import JSON** validates the full payload before writing anything:

- Invalid records block the entire import and list the reasons.
- Valid imports show a summary and offer **Replace** or **Merge**.
- Merge only updates existing IDs after an explicit confirmation checkbox.

The app reminds you when no export has been made for 30 days; disable this in Settings.

Data lives only in this browser profile. Export a JSON backup before clearing browser data or moving to another machine.

## Comparison with a market time zone

Session is manual by default. In Settings you can optionally enable **Auto-select session from time** and provide a market time zone. When both are set, entering a chart time suggests a session; the suggestion is treated as chart time in the configured market zone and can always be overridden.

## Tests

Pure calculation tests run in Node with no dependencies:

```bash
node tests/analytics.test.js
```

They cover the Appendix F worked examples, validation edge cases, target derivation, Final R, statistics, drawdown, streaks, filters, plan comparison, demo generation, and a 5,000-trade performance check.

Syntax check:

```bash
node --check analytics.js
node --check db.js
node --check ui.js
node --check app.js
```

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | Application shell and DOM landmarks |
| `style.css` | Theme, layout, table, modals, forms, responsive rules |
| `analytics.js` | Pure calculation/statistics layer (also used by the tests) |
| `db.js` | IndexedDB storage, CRUD, import/export helpers |
| `ui.js` | Rendering, forms, modals, table, analytics, screenshot manager |
| `app.js` | Application state, orchestration, handlers, import/export, demo data |
| `tests/analytics.test.js` | Node test suite |
| `vendor/chart.umd.js` | Vendored Chart.js 4.6.1 |
| `ICT_Trading_Backtesting_Journal_App_Prompt_FINAL.md` | Original product specification |

## Storage

Database name: `ictBacktestJournal` (IndexedDB v1).

Stores: `trades`, `templates`, `settings`, `screenshots`.

Screenshots are kept as compressed data URLs in a separate store; trades only keep screenshot IDs. Browser storage quotas still apply, so export backups regularly if you attach many images.
