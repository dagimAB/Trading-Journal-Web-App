# Build a Complete ICT Trading Backtesting & Journal Web App

> **Reading guide for the implementing agent:** Sections 1–71 are the full specification. Section 72 explains the research purpose, and Section 73 tells you how to work. The appendices at the end (A–G) contain the glossary, the exact formulas, the Exit Plan evaluation rules, the data model reference, the validation rules, worked examples, and the test checklist. When a section and an appendix seem to disagree, the section describes the intent and the appendix describes the exact behavior; implement the appendix and keep the intent.

---

## 1. Project Goal

Build a clean, fast, minimalist web application for recording and analyzing ICT trading backtests.

The application is primarily for **manual historical backtesting** using TradingView Bar Replay.

The user will look at historical charts, identify a setup, record the trade, continue the chart forward, observe what actually happened, and then complete the trade result.

The most important design principle is:

> **Recording a trade must be extremely fast and require as little manual data entry as possible.**

The application should NOT feel like filling out a complicated form.

The user will potentially record hundreds of trades, so the UI must minimize friction, unnecessary fields, clicks, typing, and navigation.

The application should also automatically calculate as much information as possible.

---

# 2. Core Concept

The application has two major purposes:

### A. Fast Trade Recording

A single main table should contain the user's trades.

The user should be able to see important information for every trade at once.

Do NOT force the user to open multiple sections/tabs just to enter one trade.

### B. Automatic Analysis

The application should automatically calculate:

- Total trades
- Wins
- Losses
- Breakeven trades
- Win rate
- Loss rate
- Total R
- Average R per trade
- Median R (if practical)
- Expectancy
- Average winning R
- Average losing R
- Largest winner (best trade)
- Largest loser (worst trade)
- Profit factor
- Maximum drawdown
- Current equity in R
- Longest winning streak
- Longest losing streak
- Average MFE
- Median MFE
- Average MAE
- Median MAE
- Configurable target-hit rates (percentage of trades reaching 1R, 2R, 3R, 4R, 5R, 6R, 7R, 9R, etc.)
- Target-hit rates by setup, instrument, and session
- Equity curve
- Drawdown curve
- Session performance
- Instrument performance
- Direction performance (Long vs Short)
- Setup performance
- MFE/MAE analysis by setup, instrument, session, direction, and Exit Plan
- Exit Plan performance and comparison

The user should NOT manually enter these statistics.

---

# 3. Technology

Build this as a modern responsive web application.

Preferred initial stack:

- HTML5
- CSS3
- Vanilla JavaScript
- IndexedDB for persistent local storage

Do NOT require a backend for version 1.

The application should work completely offline after loading.

Do not require:

- login
- account creation
- server
- database server
- API
- internet connection

Use IndexedDB rather than localStorage because the application may eventually contain hundreds or thousands of trades and potentially screenshot references.

Structure the project cleanly:

```text
/
├── index.html
├── style.css
├── app.js
├── db.js
├── analytics.js
├── ui.js
└── README.md
```

You may simplify the structure if necessary, but keep the code organized.

Use Chart.js only if it genuinely improves the analytics. If Chart.js is used, it must be bundled locally (not loaded from a CDN) so the application still works fully offline.

The module responsibilities are described in Section 73.

---

# 4. VERY IMPORTANT UX PRINCIPLE

The user will record potentially hundreds of trades.

Therefore:

## Do NOT create a complicated multi-step trade-entry wizard.

Avoid:

- Step 1
- Next
- Step 2
- Next
- Step 3
- Next
- Submit

That will become annoying very quickly.

Instead, use:

> **ONE MAIN TRADE TABLE**

with compact editable cells.

The user should be able to create a new trade by clicking:

**+ New Trade**

and immediately enter the important information.

The table should support:

- inline editing
- dropdowns
- date picker
- numeric inputs
- automatic calculations
- keyboard navigation
- Enter to save
- Escape to cancel
- quick duplicate
- delete
- edit
- sorting
- filtering

---

# 5. MAIN TRADE TABLE

The main screen should be dominated by one table.

This is the user's primary workspace.

The table should contain the following columns.

## Essential columns

Use these as the default visible columns:

| Column      | Purpose                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| #           | Trade number                                                             |
| Date        | Trade date                                                               |
| Session     | Asia/London/NY AM/NY PM                                                  |
| Instrument  | S&P500/NAS100/XAUUSD/GBPUSD/EURUSD                                       |
| Dir         | Long/Short                                                               |
| Setup       | Setup type                                                               |
| Quality     | A+/A/B/C                                                                 |
| Entry       | Entry price                                                              |
| SL          | Stop-loss price                                                          |
| Risk        | Risk in R                                                                |
| Exit Plan   | Compact summary of the Exit Plan, e.g. `50%@2R / 50%@4R` (click to edit) |
| MFE         | Maximum favorable excursion                                              |
| MAE         | Maximum adverse excursion                                                |
| Rem. Exit R | R at which any allocation not closed by a target was closed              |
| Result      | Final R (calculated from the Exit Plan, with optional manual override)   |
| Exit        | Exit reason                                                              |
| Levels Hit  | How many Exit Plan levels were reached (derived from MFE), e.g. `2/3`    |
| Notes       | Short notes                                                              |

This is the core table.

The **Exit Plan** column replaces any fixed TP1 / TP2 / TP3 columns. There must be NO fixed TP1/TP2/TP3 columns anywhere in the table.

The main table must show the Exit Plan compactly, for example:

- `100%@4R`
- `50%@2R / 50%@4R`
- `25%@2R / 25%@4R / 50%@7R`

Clicking the Exit Plan cell opens the small Exit Plan editor (Section 8).

---

# 6. Do NOT make every possible field mandatory

The user should NOT be forced to fill every field.

Only require:

- Date
- Instrument
- Direction
- Entry
- SL
- Final result (entered, or calculated automatically from the Exit Plan and Trade Path)

Everything else should be optional or automatically calculated.

For example, if the user does not care about HTF timeframe on a particular test, they should not be blocked from saving the trade.

Every trade also carries an Exit Plan (Section 8). A new trade must start with a valid default Exit Plan (the last-used plan or template, or a built-in starter template) so the user never has to build one just to save a trade.

MFE and MAE are very important research data and are shown prominently, but they are not required in order to save a trade. A trade that is missing MFE or MAE is still saved and still counted in the R-based statistics. It is simply left out of the specific statistic that needs the missing value (for example, a trade with no MAE is not included in the average MAE).

---

# 7. Automatically calculated fields

The application should calculate as much as possible.

## Trade number

Automatically generate:

```text
1
2
3
4
...
```

Do not ask the user to enter it.

The trade number is assigned when the trade is created (highest existing number + 1) and stays stable afterwards. Deleting a trade does not renumber the others.

## Day

Calculate automatically from Date:

```text
Monday
Tuesday
Wednesday
...
```

Do not make the user enter the day.

The Day must always be derived from the **selected historical date**. The current date, the current device time, and the user's current location or time zone must never affect it.

Implementation warning: do not parse a `YYYY-MM-DD` string with `new Date("2026-10-29")` and then read the weekday, because JavaScript treats that string as UTC and the weekday can shift by one day in some time zones. Build the date from its year, month and day numbers (for example `new Date(year, month - 1, day)`) or compute the weekday arithmetically.

## Risk

Risk should primarily be represented in **R**, not dollars.

The user's account size should not matter for historical analysis.

Example:

If the user risks $30:

```text
1R = $30
```

If the trade loses:

```text
-1R
```

If the trade makes:

```text
+6R
```

the monetary amount is irrelevant to the statistical backtest.

Allow an optional account/risk setting later if needed.

The Risk column (Section 5) holds the trade's risk in R. It defaults to `1`. If the user records a reduced-risk trade (for example `0.5`), the trade's Final R used in statistics is multiplied by that value (see Appendix B). MFE, MAE and Exit Plan target R values are always measured in multiples of the trade's own stop distance and are not scaled.

---

# 8. Flexible Exit Plan / Management System

**Do NOT hard-code TP1, TP2, and TP3.**

The app must support an arbitrary number of partial exits. An **Exit Plan** consists of one or more exit levels, where each level has:

- Allocation percentage
- Target R

Examples:

- `100% @ 4R`
- `50% @ 2R / 50% @ 4R`
- `50% @ 3R / 50% @ 6R`
- `33.3% @ 3R / 33.3% @ 6R / 33.4% @ 9R`
- `25% @ 2R / 25% @ 4R / 50% @ 7R`
- `30% @ 3R / 70% @ 6R`

The total allocation must equal exactly 100%.

(Store allocations as decimal fractions and compare the sum with a tiny tolerance after rounding, so that values like 33.3 + 33.3 + 33.4 are accepted as exactly 100% and floating-point noise never causes a false validation error. The user types percentages such as `30`; the application stores `0.30`.)

The user enters the target in **R**, not the target price.

The app automatically calculates the corresponding target price from:

- Entry price
- Stop Loss price
- Direction
- Target R

For a long trade:

```text
1R = Entry - SL
Target Price = Entry + (R Distance × Target R)
```

For a short trade:

```text
1R = SL - Entry
Target Price = Entry - (R Distance × Target R)
```

The app must display the calculated target prices inside the Exit Plan editor.

## Final R calculation

Final R must be calculated using the allocation of each exit and the actual result of the trade.

For each exit level:

- If the trade reached that level (MFE ≥ Target R), that allocation exits at the level's Target R.
- Otherwise, that allocation exits at the **Remainder Exit R**, which is the R value at which the unfilled portion of the position was closed (for example `-1` at the stop-loss, `0` at breakeven, or any value for a trailing stop or manual exit).

```text
Final R = Σ ( allocation × exit R of that level )
```

Example:

`30% @ 2R` and `70%` stopped at `-1R`:

```text
Final R = (0.30 × 2) + (0.70 × -1) = -0.10R
```

Example with breakeven on the remainder:

`30% @ 2R` and `70%` closed at `0R`:

```text
Final R = (0.30 × 2) + (0.70 × 0) = +0.60R
```

Defaults that keep entry fast:

- Exit reason `SL` automatically sets Remainder Exit R to `-1`.
- Exit reason `BE` automatically sets Remainder Exit R to `0`.
- Other reasons (trailing, manual, etc.) ask the user to type the Remainder Exit R.
- The user may always type a Final R manually to override the calculated value. Manual override must be clearly marked in the table.

### When MFE does not describe what the real management did

"Level reached" is normally derived from MFE. This can be wrong when the trader's real management closed the trade early. Example: the plan is `30% @ 2R / 70% @ 6R`, the stop was moved to breakeven after 2R, price came back and closed the remainder at 0R, and the unmanaged price later reached 8R. MFE is 8R, but the 6R level was never actually filled.

To handle this without making entry slower, the user can override the "Levels Hit" value for a trade (Section 18) by ticking or unticking individual levels. When an override exists, Final R uses the override instead of the MFE-derived value. The Final R manual override (above) is the last-resort escape hatch.

## Exit Plan editor

The Exit Plan editor must allow the user to **add, edit, remove, and reorder** exit levels.

The editor should be small and compact (a popover or small modal opened by clicking the Exit Plan cell, and also available inside the New Trade form). It should show:

- one row per exit level: allocation %, target R, and the automatically calculated target price
- a live "total allocation" indicator (must be exactly 100%)
- buttons to add a level, remove a level, and move a level up/down (or drag to reorder)
- a template dropdown and a "Save as template" button
- a live preview of the resulting Final R when the trade is completed

Do not require the user to manually calculate target prices or weighted R.

## No mandatory structure, templates only

There must be **NO mandatory 3R/6R/9R structure**.

The app may provide common templates for convenience, but users must be able to create completely custom Exit Plans.

Suggested templates:

- `100% @ 4R`
- `50% @ 2R / 50% @ 4R`
- `50% @ 3R / 50% @ 6R`
- `33.3% @ 3R / 33.3% @ 6R / 33.4% @ 9R`
- `25% @ 2R / 25% @ 4R / 50% @ 7R`

These are templates only, not fixed rules. (Section 19 lists a few additional starter templates.)

---

# 9. Session dropdown

Use a compact dropdown:

```text
Asia
London
New York AM
New York PM
London/NY Overlap
Other
```

Do not force the user to enter exact session times unless necessary.

Session is selected manually by default. A historical trade's session must never be determined from the user's current location or current time zone.

Optionally (not mandatory), the user may configure a **market time zone** in settings and enter an exact trade time (Section 42). If both exist, the app may suggest a session from the historical time in that market time zone. The user can always override the suggestion, and the feature must be switchable off.

Allow the user to add custom sessions (the "Other" option may also be used with a free-text label).

---

# 10. Instrument dropdown

Initially support:

```text
S&P500
NAS100
XAUUSD
GBPUSD
EURUSD
```

Make the list configurable so the user can add instruments later.

For each instrument, allow a configurable number of price decimals used for **display only** (for example 2 for S&P500, NAS100 and XAUUSD, and 5 for GBPUSD and EURUSD). Calculations always use full precision.

---

# 11. Direction

Dropdown:

```text
Long
Short
```

---

# 12. Setup

Do NOT create an enormous list of ICT concepts.

The setup field should be customizable.

Initially provide:

```text
FVG
Order Block
Liquidity Sweep
Breaker
OTE
MSS
Displacement
FVG + Sweep
OB + Sweep
Other
```

Allow the user to add custom setup types.

The user should be able to select multiple setup components if useful.

However, keep this fast.

Do not turn setup classification into another complicated form.

---

# 13. Setup Quality

Dropdown:

```text
A+
A
B
C
```

This is optional.

The purpose is to later determine whether high-quality setups actually perform better.

---

# 14. HTF information

Do NOT put HTF information into the default visible table if it makes the table too wide.

Instead, provide optional columns that can be shown/hidden.

Optional fields:

```text
HTF Bias
HTF Timeframe
Entry Timeframe
```

HTF Bias:

```text
Bullish
Bearish
Neutral
```

Possible timeframe values:

```text
Monthly
Weekly
Daily
4H
1H
15M
5M
1M
```

These fields should be optional.

The user should not be forced to fill them for every trade.

---

# 15. MFE and MAE

These are VERY important.

Include them in the main table.

## MFE

Maximum Favorable Excursion.

Example:

A trade enters and eventually loses -1R.

But before losing, it moved:

```text
+7.2R
```

Then:

```text
MFE = 7.2R
Final Result = -1R
```

## MAE

Maximum Adverse Excursion.

Example:

Trade:

```text
Entry
↓
-0.4R
↓
+6R
```

Then:

```text
MAE = 0.4R
```

The application should allow the user to enter MFE and MAE quickly.

Later, use this data for statistical analysis.

Both values are entered as positive numbers in R (multiples of the trade's own stop distance). MAE `0.4` means price moved 0.4R against the entry.

**How to measure MFE (important for later Exit Plan comparison):** record MFE as the maximum favorable movement on the *unmanaged* price path, that is, how far price went in the trade's favor before the **original stop-loss** would have been hit, regardless of how the trade was actually managed. If the replay was stopped earlier (for example, the trade was closed at a target or breakeven and the user stopped watching), the recorded MFE is only a lower bound, and the trade should be marked as having an incomplete path (see below). The user interface should show a short hint explaining this next to the MFE field.

## Trade Path vs Exit Plan

**Keep these two concepts separate.**

**Trade Path** represents what price actually did after entry:

```text
Entry → +2R → +5R → +7R → +4R → +1R → SL
```

From this, the app can determine values such as:

- MFE
- MAE
- Whether specific R levels were reached
- Final outcome

**Exit Plan** represents how the trader would manage that historical price path.

This separation is important because the same historical trade can be tested against multiple Exit Plans without changing the original trade data.

The architecture should be designed so future versions can store more detailed path information when necessary for accurate management-model simulation.

Implementation guidance for version 1:

- The Trade Path always contains MFE and MAE.
- Add a flag `pathComplete` (default: true when the exit reason is `SL`, otherwise false until the user ticks it) meaning "the replay was continued until the original stop-loss would have been hit, so MFE is the true maximum before the stop". This flag is what tells the Exit Plan Comparison (Section 35) whether MFE alone is enough to evaluate other plans.
- Add an optional, Tier-3 **path waypoints** field that accepts a compact sequence such as `+2, +5, +7, +4, +1, SL`. It must never slow down recording. When present, it is stored and available for future, more accurate simulations.
- Never overwrite Trade Path data when the Exit Plan is edited, and never overwrite the Exit Plan when Trade Path data is edited.

### Important limitation

MFE alone is not sufficient to perfectly simulate every possible management strategy. MFE tells the highest R reached, but not the exact order in which levels were reached or what happened afterward. The application must never pretend that it can. Simulated results must be clearly separated from recorded results and must be limited to cases where the stored Trade Path is sufficient (Section 35 and Appendix C).

---

# 16. Final Result

The Final R is normally **calculated automatically** from the Exit Plan and the Trade Path (see Section 8).

The user may also type or select a Final R directly as a manual override.

The application should support quick values such as:

```text
-1R
-0.5R
0R
+1R
+2R
+3R
+6R
+9R
```

but it must NOT restrict the user to these values.

Allow arbitrary decimal values:

```text
+4.7R
+5.25R
-0.3R
+8.4R
```

This is important because actual management may produce partial results.

The application should accept any numeric R value.

---

# 17. Exit Reason

Dropdown:

```text
SL
BE
Target (Full)
Partial Target + SL
Partial Target + BE
Trailing SL
Manual Exit
Invalidation
Session End
Other
```

Optional.

Selecting `SL` or `BE` should automatically fill the Remainder Exit R (`-1` or `0`), as described in Section 8.

---

# 18. Levels Hit (Max Target Reached)

Do NOT use a fixed dropdown of `0R / 3R / 6R / 9R`.

Instead, the application should automatically derive which levels of the trade's Exit Plan were reached from MFE.

For example, with the Exit Plan:

```text
25% @ 2R / 25% @ 4R / 50% @ 7R
```

and:

```text
MFE = 5.1R
```

the application shows:

```text
Levels Hit: 2/3  (2R ✔, 4R ✔, 7R ✘)
```

The user can override this value if needed (for example, if a level was not actually filled). The override is made by ticking or unticking individual levels. When an override exists, it is stored with the trade and is used for the Final R calculation instead of the MFE-derived value. The table must show a small marker when a trade uses an override.

Also show the highest R threshold that MFE passed, using the configurable thresholds from Section 29.

---

# 19. Exit Plan Templates / Management Models

Allow users to save **reusable Exit Plan templates**.

A template is simply a named Exit Plan, for example:

- `Full 4R`
- `50/50 2R-4R`
- `50/50 3R-6R`
- `25/25/50 2R-4R-7R`

Users can **create, edit, duplicate, rename, and delete** templates.

When recording a trade, the user can select an existing template or create a custom Exit Plan for that specific trade.

The system **must preserve the actual Exit Plan used for each historical trade.**

This means:

- When a trade uses a template, copy the template's levels into the trade (store the Exit Plan on the trade itself) and remember the template name/id for grouping.
- Editing or deleting a template later must NEVER change the Exit Plan of trades already recorded.
- Deleting a template must not break trades that were recorded with it.

The previously fixed model list (`Full 6R`, `3R / 6R / 9R`, `3R / 6R / Runner`, etc.) must not exist as hard-coded options. The application may ship with these starter templates, all of which remain editable and deletable:

- `100% @ 4R`
- `100% @ 6R`
- `50% @ 2R / 50% @ 4R`
- `50% @ 3R / 50% @ 6R`
- `33.3% @ 3R / 33.3% @ 6R / 33.4% @ 9R`
- `25% @ 2R / 25% @ 4R / 50% @ 7R`
- `30% @ 3R / 70% @ 6R`

These are examples and templates only. The system must support any valid allocation/target combination.

---

# 20. Screenshot support

Screenshots are useful, but they should NOT make trade recording annoying.

Do not force screenshots.

Allow optional:

```text
Before Screenshot
After Screenshot
```

The user should be able to:

- drag and drop an image
- click upload
- paste an image if technically possible
- preview the image
- remove the image

The screenshot should be associated with the trade.

The BEFORE screenshot should ideally show:

- setup
- entry
- SL
- liquidity
- HTF context
- session

The AFTER screenshot should show:

- actual price movement
- TP/SL
- final result

If storing image files directly in IndexedDB becomes unnecessarily large, store references/metadata and use a sensible local storage approach.

Do not sacrifice application speed because of screenshots.

Recommended approach: keep images in a separate IndexedDB object store (not inside the trade record), downscale and compress large images before saving, store only the screenshot id on the trade, and load images lazily only when the user opens a preview. Prefer storing lightweight references/metadata where possible and avoid unnecessarily large local data.

---

# 21. Notes

Notes should be short.

Do not provide a huge text editor.

Example:

```text
London sweep + displacement.
```

or:

```text
Strong HTF bearish bias.
```

or:

```text
Entered after MSS, clean FVG.
```

Keep notes optional.

---

# 22. Dashboard

The dashboard should be visible above the table.

Keep it compact.

Display cards:

```text
Total Trades
Win Rate
Total R
Avg R
Profit Factor
Max Drawdown
```

Then optionally:

```text
Avg MFE
Avg MAE
Target-hit % (for the R thresholds the user selected, e.g. 2R / 4R / 6R)
```

The target-hit cards must use the **configurable R thresholds** from Section 29, not fixed 3R/6R/9R cards.

Do not fill the screen with huge decorative cards.

The dashboard should be functional, minimalist, and professional.

All dashboard statistics and charts must reflect the **currently active filters** (Section 37). When any filter is active, show a small indicator such as `Showing 42 of 180 trades`. With no filters, the dashboard shows every completed trade.

---

# 23. Equity Curve

Below the statistics, display an equity/R curve.

The default chart should show:

```text
Trade Number
     vs
Cumulative R
```

Example:

```text
Trade 1 → -1R
Trade 2 → +5R
Trade 3 → +4R
Trade 4 → +10R
...
```

The user should be able to visually see whether the strategy is actually profitable and consistent.

Details:

- The x-axis is the position of each completed trade in the currently filtered, ordered list (1, 2, 3, ...).
- Provide a small toggle to order trades either by trade number (the order they were recorded) or chronologically by historical date and time.
- Show the current equity in R (the last point of the curve), the best trade, and the worst trade next to the chart or in the dashboard.

---

# 24. Drawdown

Also calculate maximum drawdown.

Example:

```text
Peak = +20R
Later = +12R

Drawdown = -8R
```

Display:

```text
Maximum Drawdown: 8R
```

Optionally show a drawdown chart.

---

# 25. Streaks

Automatically calculate:

```text
Longest Winning Streak
Longest Losing Streak
```

Example:

```text
W W W L L W L L L W

Longest winning streak = 3
Longest losing streak = 3
```

A breakeven trade ends the current streak (it counts as neither a win nor a loss).

---

# 26. Win Rate

Calculate:

```text
Wins / Total completed trades × 100
```

Do not count incomplete trades.

Classification of a completed trade by Final R:

```text
Win        = Final R > 0
Loss       = Final R < 0
Breakeven  = Final R = 0
```

(Optionally provide a small configurable tolerance around 0R for breakeven.)

---

# 27. Profit Factor

Calculate:

```text
Gross Winning R / Absolute Gross Losing R
```

Example:

```text
Gross wins = +120R
Gross losses = -60R

Profit Factor = 2.0
```

If there are winning trades but no losing trades, display `∞`. If there are no completed trades, display `—`.

---

# 28. Average R

Calculate:

```text
Total R / Number of completed trades
```

This is one of the most important statistics. Expectancy in R is the same number (see Appendix B).

---

# 29. MFE Analysis and Configurable Target-Hit Rates

Create a compact analytics area.

Show configurable target-hit rates such as **1R, 2R, 3R, 4R, 5R, 6R, 7R, 9R, etc.**

The user must be able to **select which R thresholds to analyze** (for example by adding/removing thresholds in a small settings control). Provide a sensible default such as `1R, 2R, 3R, 4R, 6R, 9R`, but do not hard-code them.

For example:

```text
1R → 72%
2R → 61%
3R → 51%
4R → 41%
6R → 29%
9R → 12%
```

This is extremely important for determining which Exit Plan structure makes sense for the strategy.

A trade counts as "reaching" a threshold when its MFE is greater than or equal to that threshold. Show how many trades were included. Provide a switch: **All completed trades** (default) or **Only trades with a complete path**, and show how many trades are excluded by the switch, because an incomplete path can understate MFE.

Also show the target-hit rates broken down by **setup**, by **instrument**, and by **session**.

### 29A. MFE/MAE by group

The user should be able to see average MFE and average MAE grouped by setup, instrument, session, direction, and Exit Plan (see also Sections 32–34).

---

# 30. MFE Distribution

Create ranges:

```text
<1R
1R–3R
3R–6R
6R–9R
9R+
```

(Make the range boundaries configurable, using the same thresholds the user selected in Section 29 where practical.)

Show:

```text
Number of trades
Percentage
Average final R
```

This will help identify how far trades normally travel.

---

# 31. MAE Analysis

Similarly analyze:

```text
0–0.25R
0.25–0.5R
0.5–0.75R
0.75–1R
>1R
```

This helps determine whether stops are too tight or whether certain setups usually experience significant adverse movement before becoming winners.

Show for each range: number of trades, percentage, and average final R.

---

# 32. Session Analysis

The user should NOT have to navigate away from the main table just to record trades.

However, analysis can be displayed in a collapsible analytics area or dashboard.

Show:

| Session | Trades | Win Rate | Avg R | Total R | Avg MFE | Avg MAE |
| ------- | -----: | -------: | ----: | ------: | ------: | ------: |
| Asia    |        |          |       |         |         |         |
| London  |        |          |       |         |         |         |
| NY AM   |        |          |       |         |         |         |
| NY PM   |        |          |       |         |         |         |

---

# 33. Instrument Analysis

Show:

| Instrument | Trades | Win Rate | Avg R | Total R | Avg MFE | Avg MAE |
| ---------- | -----: | -------: | ----: | ------: | ------: | ------: |
| S&P500     |        |          |       |         |         |         |
| NAS100     |        |          |       |         |         |         |
| XAUUSD     |        |          |       |         |         |         |
| GBPUSD     |        |          |       |         |         |         |
| EURUSD     |        |          |       |         |         |         |

---

# 34. Setup Analysis

Show:

| Setup           | Trades | Win Rate | Avg R | Total R | MFE |
| --------------- | -----: | -------: | ----: | ------: | --: |
| FVG             |        |          |       |         |     |
| Liquidity Sweep |        |          |       |         |     |
| Order Block     |        |          |       |         |     |
| etc.            |        |          |       |         |     |

### 34A. Direction Analysis

Show the same columns as the Session table for `Long` and `Short`:

| Direction | Trades | Win Rate | Avg R | Total R | Avg MFE | Avg MAE |
| --------- | -----: | -------: | ----: | ------: | ------: | ------: |
| Long      |        |          |       |         |         |         |
| Short     |        |          |       |         |         |         |

All analysis tables are built from the same filtered dataset as the dashboard. A trade that is missing a value needed for one column is left out of that column only. Each table should show the sample size (`Trades`) so the user can judge reliability (see Section 72).

---

# 35. Exit Plan Comparison

The analytics system should allow the user to **compare different saved Exit Plans using historical trade data.**

For example:

- `100% @ 4R`
- `50% @ 2R / 50% @ 4R`
- `50% @ 3R / 50% @ 6R`
- `25% @ 2R / 25% @ 4R / 50% @ 7R`

Show for each Exit Plan:

- Number of trades
- Win rate
- Average R
- Total R
- Profit factor
- Maximum drawdown
- Expectancy
- Best trade
- Worst trade

Provide two clearly labeled modes:

1. **As recorded:** group the trades by the Exit Plan that was actually used when each trade was recorded. Results in this mode are labeled **Recorded**.
2. **Re-evaluate:** apply one or more saved Exit Plans to the same set of historical trades, using their recorded Trade Paths, and compare the resulting statistics side by side. Results in this mode are labeled **Simulated**.

**Important:** management comparison must be based on the recorded historical Trade Path where sufficient information exists. **Do not assume that MFE alone can perfectly reconstruct every possible management strategy.**

For re-evaluation, label each trade's evaluation quality:

- **Exact:** the Trade Path is sufficient to evaluate the plan (for example, `pathComplete = true`, so MFE is the true maximum before the original stop, and the plan has no stop-moving rules).
- **Insufficient:** the Trade Path cannot answer the question (for example, the replay was stopped early, or the plan depends on the order of price moves that was not recorded). These trades must be **excluded from that plan's statistics** and counted in a visible "excluded trades" number, never silently guessed.

Always display how many trades were evaluated and how many were excluded, so the user can judge how reliable the comparison is. Never mix Recorded and Simulated numbers in the same row without labeling them. The exact rules are in Appendix C.

The architecture should keep the historical **Trade Path** separate from the **Exit Plan** so that the same historical trades can be evaluated under different Exit Plans (see Section 15).

Do not hard-code any comparison between specific fixed models such as `Full 6R` vs `3R/6R/9R`. The user chooses which saved Exit Plans to compare.

---

# 36. Important distinction: MFE vs Final Result

The application must preserve the difference between:

```text
MFE
```

and

```text
Final Result
```

Example:

```text
MFE = 8.2R
Final Result = -1R
```

This is valuable information.

It means the setup had significant potential but the management failed to capture it.

This data should NOT be lost.

---

# 37. Trade Table Filtering

The table must support fast filters.

Filters:

```text
Date range
Instrument
Session
Direction
Setup
Quality
Result (Win / Loss / Breakeven)
Exit Plan (template name or exact plan)
MFE range
MAE range
Final R range
Dataset / strategy
Status (Completed / Incomplete)
```

Quick filters:

```text
All
Wins
Losses
BE
MFE ≥ X R  (X selectable by the user, e.g. 2R, 4R, 6R, 9R)
```

Also allow free-text search (searching notes, setup, instrument, and similar text fields).

Filter and search inputs must be debounced so typing stays smooth. All dashboard statistics and charts update according to the active filters (Section 22).

---

# 38. Table Sorting

Allow sorting by:

```text
Trade number
Date
Instrument
Session
Setup
MFE
MAE
Final R
```

---

# 39. Freeze Important Columns

Because the table may become wide, freeze the first few columns:

```text
#
Date
Instrument
```

while horizontally scrolling.

This is very important for usability.

---

# 40. Column Visibility

The default table should stay reasonably compact.

Allow:

```text
Columns
```

button where the user can toggle optional columns.

Default visible:

```text
#
Date
Session
Instrument
Dir
Setup
Quality
Entry
SL
Risk
Exit Plan
MFE
MAE
Rem. Exit R
Result
Exit
Levels Hit
Notes
```

Optional:

```text
Day
Killzone
HTF Bias
HTF Timeframe
Entry Timeframe
Time
Screenshot
Plan Template Name
Path Waypoints
Dataset
```

This allows the user to have everything available without making the interface unusably wide.

The column visibility choice is saved in settings and restored after a refresh.

---

# 41. Killzone

Optional dropdown:

```text
Asian Killzone
London Killzone
NY AM Killzone
NY PM Killzone
Outside Killzone
```

The user should be able to disable/hide this column if they don't want to record it.

---

# 42. Time

Optional.

If the user records exact trade time:

```text
09:35
```

Store it.

But do not require it.

The stored time is the historical time the user read from the chart. It must remain independent of the current device date and time.

---

# 43. Import / Export

This is extremely important.

Provide:

```text
Export JSON
Import JSON
Export CSV
```

The user must be able to back up their entire journal.

Do not make the data dependent on one browser installation.

JSON should preserve:

- trades (including each trade's Exit Plan and Trade Path)
- Exit Plan templates
- settings
- custom setup types
- custom instruments
- configurable target-hit thresholds
- preferences

CSV should export the trade table (the Exit Plan should be exported as a readable string such as `50%@2R / 50%@4R`).

Import must be safe:

- Validate the file structure and every record before anything is written.
- Show a short summary (for example: `180 trades, 7 templates, 3 custom setups`) and ask whether to **Replace** the existing data or **Merge** with it.
- On merge, records with an id that already exists are updated only after the user confirms; never overwrite silently.
- If validation fails, import nothing and show which records were invalid and why.
- Include a format version number in the exported JSON so future versions can migrate old files.

---

# 44. Automatic Backup Reminder

Optionally show:

> "You haven't exported a backup in 30 days."

But do not make this annoying.

Allow the user to disable the reminder.

---

# 45. Data Validation

Prevent invalid trades.

Examples:

If Long:

```text
SL must be below Entry
```

If Short:

```text
SL must be above Entry
```

Risk distance cannot be zero.

MFE should not normally be negative.

MAE should not normally be negative.

Final R must be numeric.

Exit Plan validation:

```text
Exit Plan must have at least one level
Total allocation must equal exactly 100%
Each allocation must be greater than 0%
Each Target R must be greater than 0
Duplicate Target R values should show a warning
Levels out of ascending R order should show a warning (or be auto-sorted for evaluation)
```

Show friendly validation messages.

Do not use annoying browser alert boxes everywhere.

Use inline validation.

The full list of rules, including which are blocking errors and which are warnings, is in Appendix E.

---

# 46. Incomplete Trade State

The user may initially create a trade before knowing the result.

Example:

```text
Date
Instrument
Direction
Entry
SL
Setup
Exit Plan
```

Then save it as:

```text
OPEN / INCOMPLETE
```

Later, after continuing TradingView Replay, they return and fill:

```text
MFE
MAE
Rem. Exit R (or Exit reason)
Final R (calculated automatically, or manual override)
```

The application should distinguish:

```text
Incomplete
Completed
```

Incomplete trades should NOT affect performance statistics.

A trade becomes **Completed** automatically as soon as a Final R can be determined: either a manual Final R exists, or MFE and an exit result (an exit reason of SL or BE, or a typed Remainder Exit R) exist. Otherwise it stays **Incomplete**. The status is recalculated on every save.

---

# 47. Blind Backtest Mode

Add an optional button:

```text
Start Blind Backtest
```

This should make the workflow extremely simple.

Example:

### Step 1

User starts TradingView Bar Replay.

### Step 2

User identifies setup.

### Step 3

Click:

```text
+ New Trade
```

### Step 4

Enter only:

```text
Date
Instrument
Session
Direction
Setup
Entry
SL
Exit Plan (defaults to the last-used Exit Plan or template)
```

### Step 5

Save.

### Step 6

Continue Bar Replay without looking ahead.

### Step 7

When the trade resolves, edit the trade and enter:

```text
MFE
MAE
Exit Reason (auto-fills Rem. Exit R for SL / BE)
```

Final R is calculated automatically.

### Step 8

Statistics update automatically.

This should be the fastest workflow in the application.

### Protection against accidental future-data leakage

The user is replaying history and must not accidentally see information that was not known at entry. While Blind Backtest mode is active:

- The New Trade form shows only entry-time fields (the Step 4 list). The result fields (MFE, MAE, Rem. Exit R, Final R, Exit Reason, Levels Hit) are not shown in that form.
- Result fields are filled in only afterwards through a separate **Complete Trade** action on an open trade.
- Result columns of incomplete trades are blank (they have no values yet), and the user can choose to hide the result columns, the dashboard, and the equity curve while in this mode with one toggle, so that earlier results cannot bias the next decision.
- Nothing in the interface may pre-fill result values from other trades.

---

# 48. Keyboard-first workflow

This is important because the user may record hundreds of trades.

Support keyboard navigation.

For example:

```text
Ctrl + N → New Trade
Ctrl + F → Search
Ctrl + E → Export
Escape → Close modal
Enter → Save
```

Within the trade table:

```text
Tab → next field
Shift + Tab → previous field
Enter → save
Escape → cancel
```

If practical, support arrow-key navigation.

Keyboard shortcuts must not trigger while the user is typing in a text field in a way that would lose data (for example, `Ctrl + F` focuses the app's search box and prevents the browser's default search only inside the app).

---

# 49. Duplicate Trade

Add:

```text
Duplicate
```

This is a convenience for starting a new trade from an existing one (same instrument, session, setup, and Exit Plan, with a different entry and result), and for trying a different Exit Plan on a copy of a trade.

Note: because one real historical trade copied twice would be counted twice in the overall statistics, the preferred way to compare different Exit Plans on the same historical trade is the Exit Plan Comparison (Section 35). If the user does duplicate a trade, make it obvious in the table that it is a copy.

### 49A. Trade Actions

Each trade supports these actions (from the row menu or by keyboard where practical):

- **Add** a new trade
- **Edit** a trade (inline or in the compact editor)
- **Duplicate** a trade
- **Delete** a trade, with confirmation and Undo (Sections 59 and 60)
- **Open details**: a compact side panel showing the whole trade, including the Exit Plan with calculated target prices, the Final R calculation breakdown, the Trade Path, notes, and the screenshots
- **Apply Exit Plan template**: apply a saved template to a trade's Exit Plan, with the option to apply it to all selected rows at once. The application must ask for confirmation, because it changes the recorded Exit Plan of those trades.

---

# 50. Strategy / Dataset Separation

Allow the user to define a dataset or strategy name.

Example:

```text
ICT 2026 Backtest
```

or:

```text
London Sweep Model
```

This allows separate backtests.

However, do not make this complicated.

A simple optional field is enough.

The dataset name is available as a filter (Section 37) and as an optional column. Choosing a dataset in the filter bar makes the dashboard show only that dataset. This also makes it easy to keep an out-of-sample test separate from the original sample (Section 72).

---

# 51. Strategy Rules

Include a simple text area in settings for documenting the rules.

Example:

```text
HTF bearish bias
+
Liquidity sweep
+
MSS
+
Displacement
+
FVG entry
```

This is NOT part of every trade.

It is a strategy-level note.

---

# 52. Dark Mode

The application should support dark mode.

Default:

```text
Dark
```

because this is a trading/backtesting application.

Provide a toggle:

```text
Dark / Light
```

Keep the design professional.

Avoid excessive neon trading aesthetics.

Do NOT make it look like a gambling platform.

---

# 53. Visual Style

Design should be:

- minimalist
- professional
- clean
- fast
- dark
- trading-terminal inspired
- compact
- readable

Avoid:

- excessive gradients
- huge cards
- excessive animations
- unnecessary icons
- distracting colors
- crypto-style UI
- gaming UI

Use color sparingly.

Suggested meaning:

```text
Green = positive
Red = negative
Yellow/orange = warning
Neutral gray = normal
```

Do not rely only on color to communicate information.

Show a `+` sign on positive R values and a `-` sign on negative ones, so the meaning is clear without color. Use a monospace or tabular-number font for numeric columns so digits line up.

---

# 54. Responsive Design

Desktop is the primary environment.

The user will mainly use this on a PC.

However, the application should still work reasonably on smaller screens.

On mobile/tablet, the table can become horizontally scrollable.

Do NOT redesign the whole application into cards on mobile unless necessary.

---

# 55. Performance

The application must remain fast with:

```text
100 trades
500 trades
1,000 trades
5,000 trades
```

Do not recalculate unnecessarily.

Use efficient filtering and rendering.

For large datasets, render only the visible rows if necessary.

Exit Plan re-evaluation across many trades and many plans must also stay fast; cache results and invalidate them only when the relevant trades or plans change.

Additional requirements:

- Debounce search and filter input.
- Avoid unnecessary DOM re-renders (update only the changed row when a single trade is edited).
- Keep charts responsive and avoid re-creating them when only the data changes.
- Access IndexedDB efficiently (use indexes, batch writes for imports and demo data).

---

# 56. Data Model

A trade object should approximately look like:

```javascript
{
  id: "...",
  tradeNumber: 1,

  date: "2026-10-29",
  time: "09:35",

  session: "London",
  killzone: "London Killzone",

  instrument: "S&P500",
  direction: "Long",

  htfBias: "Bullish",
  htfTimeframe: "4H",
  entryTimeframe: "5M",

  setup: "Liquidity Sweep + FVG",
  setupQuality: "A+",

  entry: 6800.25,
  stopLoss: 6790.25,

  riskR: 1,

  // --- EXIT PLAN: how the trader manages the trade ---
  // Any number of levels. Total allocation must equal 1.0 (100%).
  exitPlan: [
    { allocation: 0.30, targetR: 2 },
    { allocation: 0.70, targetR: 6 }
  ],
  exitPlanTemplateId: "tpl-30-70-2R-6R",   // optional, for grouping; the plan above is the source of truth

  // --- TRADE PATH: what price actually did after entry ---
  tradePath: {
    mfe: 7.2,
    mae: 0.4,
    pathComplete: true,          // replay continued until the original SL would have been hit
    waypoints: null              // optional, e.g. [2, 5, 7, 4, 1] for "+2, +5, +7, +4, +1, SL"
  },

  // --- ACTUAL OUTCOME ---
  remainderExitR: -1,            // R at which any allocation not closed by a target was closed
  levelsHitOverride: null,       // optional, e.g. [true, false]; one boolean per Exit Plan level
  finalROverride: null,          // optional manual Final R; normally Final R is derived

  exitReason: "SL",

  status: "completed",

  screenshotBefore: null,
  screenshotAfter: null,

  notes: "Strong sweep but failed after reaching 6R",

  dataset: "ICT 2026 Backtest",

  isDemo: false,

  createdAt: "...",
  updatedAt: "..."
}
```

Do **NOT** use fixed fields such as `tp1R`, `tp2R`, `tp3R`, `tp1Price`, `tp2Price`, `tp3Price`. They must not exist anywhere in the data model.

The `exitPlan` array must support **any number of exit levels**.

Target prices are **derived values** calculated from `entry`, `stopLoss`, `direction`, and each level's `targetR`. They must never require manual input.

An Exit Plan template object should approximately look like:

```javascript
{
  id: "tpl-30-70-2R-6R",
  name: "30/70 2R-6R",
  levels: [
    { allocation: 0.30, targetR: 2 },
    { allocation: 0.70, targetR: 6 }
  ],
  createdAt: "...",
  updatedAt: "..."
}
```

The exact schema may be improved by the developer, but preserve the concepts, especially the separation of **Trade Path**, **Exit Plan**, and **actual outcome**. A field-by-field reference and the IndexedDB layout are in Appendix D.

---

# 57. Do NOT Store Redundant Data

Avoid storing things that can always be calculated.

For example:

Do NOT permanently store:

```text
day
target prices for each Exit Plan level
Final R (unless it is a manual override)
levels hit (unless it is a manual override)
weighted R
winRate
profitFactor
averageR
```

if they can be derived from:

```text
date
entry
SL
direction
exitPlan
tradePath (MFE, MAE, waypoints)
remainderExitR
all trades
```

You may cache calculated values for performance, but the source of truth should remain the raw trade data.

This prevents inconsistent data.

Every stored field must have a clear research purpose. Do not store the same statistic in more than one place.

---

# 58. Statistics Should Recalculate Automatically

Whenever a trade is:

- added
- edited
- deleted
- imported

or whenever an Exit Plan is edited, the statistics should be recalculated.

No "Calculate" button should be necessary.

The dashboard should always reflect the current (filtered) dataset.

---

# 59. Delete Confirmation

When deleting a trade:

```text
Delete this trade?
```

Provide:

```text
Cancel
Delete
```

Do not accidentally delete trades.

---

# 60. Undo Delete

If practical, support:

```text
Undo
```

after deleting a trade.

This is preferable to permanent deletion immediately.

A short-lived "Trade deleted. Undo" message should appear immediately after deletion and restore the trade (with its screenshots) in its original place, including its trade number.

---

# 61. Empty State

When there are no trades:

Show:

```text
No trades recorded yet.

Start your first blind backtest.
```

with:

```text
+ New Trade
```

Do not show meaningless zeros everywhere without explanation.

---

# 62. Example Data

Include a small optional sample dataset for testing the application.

For example:

```text
20 sample trades
```

with realistic values, using a mix of different Exit Plans (single-exit and multi-exit).

Provide a button:

```text
Load Demo Data
```

and:

```text
Clear Demo Data
```

Make sure demo data cannot accidentally mix with the user's real data without warning.

Implementation: every demo trade carries `isDemo: true`. "Clear Demo Data" removes only records flagged `isDemo` and never touches real trades. If the user already has real trades when pressing "Load Demo Data", show a warning and either load the demo trades into a separate dataset or ask for confirmation. Demo data must be visibly marked in the table. For developer testing, also provide a way to generate 100+ (and optionally 1,000+) sample trades.

---

# 63. Main Page Layout

Recommended structure:

```text
┌─────────────────────────────────────────────────────────────┐
│ ICT BACKTEST JOURNAL      [Blind Backtest] [Import/Export]  │
│                                            + NEW TRADE      │
├─────────────────────────────────────────────────────────────┤
│ Total │ Win Rate │ Total R │ Avg R │ PF │ Max DD           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    EQUITY CURVE                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Filters: [Instrument] [Session] [Setup] [Result] [Search]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    MAIN TRADE TABLE                         │
│                                                             │
│ # │ Date │ Session │ Instrument │ Dir │ Setup │ Exit Plan  │
│                                                             │
│ 1 │ ...  │ London  │ S&P500    │ L   │ FVG   │ 100%@4R   │
│ 2 │ ...  │ NY AM   │ NAS100    │ S   │ Sweep │ 50%@2R/..  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Analytics                                                   │
│                                                             │
│ Session | Instrument | Direction | Setup | MFE/MAE |        │
│ Target-Hit Rates | Exit Plan Comparison                     │
├─────────────────────────────────────────────────────────────┤
│ Footer / Settings                                           │
└─────────────────────────────────────────────────────────────┘
```

The table is the center of the application.

---

# 64. Trade Entry UI

When clicking:

```text
+ New Trade
```

use a compact modal or inline new row.

DO NOT create a full-screen page.

Example:

```text
Date       [2026-10-29]
Session    [London ▼]
Instrument [S&P500 ▼]
Direction  [Long ▼]
Setup      [Liquidity Sweep ▼]
Quality    [A+ ▼]

Entry      [6800.25]
SL         [6790.25]

Exit Plan  [Template ▼ / Custom]
           30% @ 2R → 6820.25
           70% @ 6R → 6860.25
           Total: 100%  [+ Add level]

[Save Trade]
```

Then later:

```text
MFE
MAE
Exit Reason / Rem. Exit R
```

can be completed, and Final R is calculated automatically.

Optional fields (HTF information, Killzone, time, dataset, notes, screenshots) are collapsed by default so the form stays short. The first field receives focus automatically, and the previous trade's date, instrument, session, and Exit Plan are remembered as defaults to save typing.

---

# 65. Optimize for Speed

The ideal process should take roughly:

### Initial trade

10–20 seconds to record.

### Trade completion

5–10 seconds.

The user should NOT spend one or two minutes entering metadata for every trade.

This is extremely important.

If a field doesn't contribute significantly to later analysis, make it optional or remove it.

The Exit Plan must default to the last-used plan or template so that the user does not need to set it up for every trade.

---

# 66. Most Important Data Hierarchy

Prioritize fields like this.

### Tier 1 — Essential

```text
Date
Instrument
Direction
Entry
SL
Final R (calculated or entered)
MFE
MAE
```

### Tier 2 — Highly useful

```text
Session
Setup
Setup Quality
Exit Plan
Exit Reason
Rem. Exit R
```

### Tier 3 — Optional

```text
Killzone
HTF Bias
HTF Timeframe
Entry Timeframe
Exact Time
Path Waypoints
Screenshots
Notes
```

The application should make Tier 1 extremely fast.

Tier 2 should also be easy.

Tier 3 should never slow the user down.

---

# 67. Important Statistical Goal

The application is ultimately designed to answer questions such as:

### Strategy performance

```text
Does this ICT setup actually have positive expectancy?
```

### Session performance

```text
Does it perform better in London or NY AM?
```

### Instrument performance

```text
Does it perform better on S&P500 than NAS100?
```

### Setup quality

```text
Are A+ setups actually significantly better than B setups?
```

### MFE

```text
How often does a trade reach 2R? 4R? 6R? 9R? (thresholds chosen by the user)
```

### Management

```text
Which Exit Plan produces the best expectancy: 100% @ 4R,
50% @ 2R / 50% @ 4R, 25% @ 2R / 25% @ 4R / 50% @ 7R, or something else?
```

### Risk management

```text
Are stops being hit after significant favorable movement?
```

The application should make these questions easy to answer from the collected data.

---

# 68. Avoid Overengineering

This is a personal research/backtesting tool.

Do NOT add unnecessary features such as:

- social features
- chat
- broker integration
- live trading
- live order execution
- automated signals
- AI predictions
- news feed
- economic news feeds
- crypto prices
- economic calendar
- account management
- accounts/authentication for v1
- payments
- user registration
- cloud synchronization
- complex backend infrastructure

The application is NOT a trading platform.

It is a:

> **Backtesting + Trade Journal + Statistical Analysis tool.**

Keep the scope focused.

---

# 69. Future Architecture

Build version 1 locally, but write the code so it can later be migrated to:

```text
React
+
Node.js/Express
+
PostgreSQL
```

if needed.

Do not build the backend now.

The current version should be completely usable without a backend.

Design the data layer so that:

- Trade Path and Exit Plan stay separate objects.
- More detailed path data (full waypoint sequences) can be added later without changing the Exit Plan structure.
- Stop-management rules (for example, move the stop to breakeven after the first target, or trailing stops) can later be added to the Exit Plan structure and evaluated against stored path data.

Keep calculation code in pure functions (no DOM access) so it can be reused unchanged in a future React or Node version.

---

# 70. Final Acceptance Criteria

The application is considered successful only if the following workflow is easy:

### Workflow

1. Open application.
2. Click "+ New Trade".
3. Enter:
   - Date
   - Session
   - Instrument
   - Direction
   - Setup
   - Entry
   - SL
   - Exit Plan (template or custom)
4. Save.
5. Continue TradingView Bar Replay.
6. Return to the application.
7. Enter:
   - MFE
   - MAE
   - Exit reason (and Rem. Exit R if it is not SL or BE)
8. Save. Final R is calculated automatically from the Exit Plan.
9. Dashboard immediately updates.
10. Equity curve updates.
11. Statistics update.
12. Filters work.
13. Trade remains permanently saved after refreshing the browser.

The user should never need to manually calculate:

- target prices
- weighted Final R
- win rate
- total R
- average R
- profit factor
- drawdown
- streaks
- target-hit percentages
- MFE percentages
- MAE statistics

Additional acceptance criteria:

- A user can add a trade from the main table without navigating through multiple pages.
- Day is automatically calculated from the historical Date and never from the current date or location.
- Entry, SL, Direction, and target R values correctly produce target prices.
- The user can create an Exit Plan with any number of exits, and allocations must total 100%.
- The main table displays the Exit Plan compactly instead of fixed TP1/TP2/TP3 columns.
- Final R is correctly calculated from weighted exits.
- The application supports incomplete trades, and they never affect statistics.
- The application can compare multiple Exit Plans against historical data where the Trade Path contains sufficient information, and it clearly separates Recorded results from Simulated ones and shows excluded trades.
- Filters and sorting work correctly, and dashboard statistics update after filtering.
- Equity curve and drawdown are correct.
- JSON import/export preserves the complete dataset, and CSV export works.
- Delete and Undo work.
- Keyboard shortcuts work.
- The application remains responsive with 100+ trades.
- No fixed TP1/TP2/TP3 assumptions remain anywhere in the implementation.

---

# 71. Final Design Philosophy

Build this application around one principle:

> **The easier it is to record a trade, the more trades the user will actually record.**

Do not optimize for having the maximum number of fields.

Optimize for:

```text
Fast recording
+
Clean data
+
Automatic calculations
+
Useful statistics
+
Minimal friction
```

The main trade table should be the heart of the application.

Everything else should help the user understand the data collected in that table.

The application should feel like a professional personal research tool rather than a complicated spreadsheet or a commercial trading platform.

Build the smallest clean system that makes rigorous backtesting easy. Every automatic calculation should reduce manual work. Every stored field should have a clear research purpose. Preserve the historical Trade Path, keep the Exit Plan flexible, and make the statistics trustworthy.

Before finishing, test the application with at least 100 sample trades and verify that all calculations remain correct after:

- adding trades
- editing trades
- deleting trades
- importing trades
- exporting trades
- refreshing the browser
- filtering
- sorting
- changing Exit Plans (per trade and via templates)
- editing or deleting a template (existing trades must keep the Exit Plan they were recorded with)
- Exit Plans with 1, 2, 3, and 4+ levels, including allocations such as 33.3 / 33.3 / 33.4
- entering decimal R values
- mixing winning and losing trades
- incomplete trades
- re-evaluating the same trades under different Exit Plans, with insufficient-path trades excluded and counted

Make sure no calculated statistics include incomplete trades.

Make sure data persists after browser refresh.

Make sure the application can export a complete backup.

Deliver the complete working application with all source files and clear instructions for running it locally.

---

# 72. Statistical Purpose and Research Discipline

The application is intended to help determine what actually works from historical data rather than what theoretically looks good. The design should support that goal.

- **Focus on sample size.** Always show the number of trades behind every statistic. When a group has a small sample (for example, fewer than 30 trades), show a subtle "low sample size" indicator next to it, so the user does not over-trust a result. The threshold is configurable in settings.
- **Preserve raw historical observations.** Raw trade data (entry, stop, Exit Plan, Trade Path, outcome) is never silently modified by analytics. Calculated values are derived, not stored over the raw data.
- **Make results reproducible.** Because the Exit Plan used and the Trade Path are stored with each trade, the same dataset always produces the same statistics.
- **Avoid changing rules repeatedly during the same test sample.** The Strategy Rules text area (Section 51) and the dataset name (Section 50) let the user document the rules for a test and keep each test sample separate. Do not add features that encourage constantly re-tuning on the same data.
- **Make weaknesses easy to find.** Breakdowns by session, instrument, direction, setup, quality, and Exit Plan, plus MFE and MAE analysis, should make weak spots visible.
- **Support later out-of-sample testing.** The user can record a second batch of trades under a different dataset name or in a later date range and compare it with the first batch using the filters.

---

# 73. Instructions to the Implementing Agent

### How to work

1. Read this whole document and the appendices before writing code.
2. Build the calculation layer first as pure functions (Appendix B and C), and verify it against the worked examples in Appendix F before building any interface.
3. Then build the IndexedDB layer (Appendix D), then the main table with the New Trade form and the Exit Plan editor, then the dashboard and charts, then filters and sorting, then import/export, then Blind Backtest mode, demo data, and polish.
4. Work through the test checklist (Appendix G) at the end.
5. Do not ask the user to enter anything the application can calculate. If this document leaves a small detail open, choose the simplest behavior that follows the design principles in Sections 1, 4, and 65, and write the decision in the README.
6. Do not add features listed in Section 68.

### Module responsibilities

| File           | Responsibility                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `db.js`        | All IndexedDB access: open/upgrade the database, create/read/update/delete trades, templates, settings and screenshots, batch operations, export and import of the whole dataset. No DOM code. |
| `analytics.js` | Pure functions only: derive target prices, day of week, Final R, levels hit, status, all statistics, drawdown, streaks, target-hit rates, distributions, Exit Plan evaluation and comparison. No DOM code, no database code. |
| `ui.js`        | Rendering and DOM behavior: table, inline editing, modals and popovers, Exit Plan editor, filters, charts, toasts and inline validation messages, column visibility.                    |
| `app.js`       | Application state, startup, wiring between `db.js`, `analytics.js` and `ui.js`, keyboard shortcuts, Blind Backtest mode, settings.                                                     |
| `README.md`    | How to run locally (open `index.html`; if a local server is required for IndexedDB in the chosen browser, explain the one-line command), feature overview, decisions made, known limits. |

### Decisions already made (do not change them)

- Trade numbers are stable and are not renumbered after a delete.
- Allocations are stored as fractions (`0.30`), shown as percentages (`30%`).
- Calculations use full precision; rounding happens only for display.
- Statistics use completed trades only.
- A breakeven trade ends a win or loss streak.
- Target-hit analysis counts a trade as reaching a level when MFE ≥ the level.

---

# Appendix A — Glossary

| Term                      | Meaning                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R**                     | One unit of risk: the distance between Entry and Stop Loss for that trade. A +3R move means price moved three times the stop distance in the trade's favor.                              |
| **1R distance**           | `abs(Entry − SL)` in price units.                                                                                                                                                        |
| **Target R**              | The R multiple at which an Exit Plan level closes its share of the position.                                                                                                             |
| **MFE**                   | Maximum Favorable Excursion: the furthest price moved in the trade's favor, in R, measured on the unmanaged price path before the original stop-loss would have been hit.                |
| **MAE**                   | Maximum Adverse Excursion: the furthest price moved against the entry, in R, before the trade moved in its favor or ended.                                                               |
| **Trade Path**            | What price actually did after entry (MFE, MAE, whether the path is complete, optional waypoints). It does not depend on how the trader managed the trade.                                |
| **Exit Plan**             | How the position is split and where each part exits: a list of `{allocation, targetR}` levels totaling 100%.                                                                             |
| **Exit Plan level**       | One row of an Exit Plan, for example `50% @ 2R`.                                                                                                                                         |
| **Remainder Exit R**      | The R at which any part of the position that did not reach its target was closed (for example `-1` at the stop, `0` at breakeven).                                                       |
| **Levels Hit**            | Which Exit Plan levels were reached. Derived from MFE, optionally overridden by the user.                                                                                                |
| **Final R**               | The trade's result in R: the weighted sum of what each level earned, multiplied by the trade's risk in R. Can be overridden manually.                                                    |
| **Path complete**         | The replay was continued until the original stop-loss would have been hit, so MFE is the true maximum and other Exit Plans can be evaluated exactly.                                     |
| **Recorded result**       | A result that comes from the Exit Plan actually used on the trade.                                                                                                                       |
| **Simulated result**      | A result obtained by applying a different Exit Plan to the stored Trade Path.                                                                                                            |
| **Completed / Incomplete**| A trade is Completed once its Final R can be determined. Incomplete trades are excluded from all statistics.                                                                             |
| **Expectancy**            | Average Final R per completed trade.                                                                                                                                                     |
| **Dataset**               | An optional name that groups trades into a separate backtest.                                                                                                                            |

---

# Appendix B — Calculation Reference

All formulas use full numeric precision. Round only when displaying.

### B1. Price distance and target prices

```text
rDistance = abs(entry − stopLoss)                       // must be > 0

Long :  targetPrice(R) = entry + rDistance × R
Short:  targetPrice(R) = entry − rDistance × R
```

### B2. Exit Plan validation

```text
levels.length ≥ 1
each allocation > 0
each targetR > 0
round(sum(allocation) × 10000) / 10000 == 1          // tolerance for floating-point noise
```

### B3. Which levels were hit

```text
if levelsHitOverride exists (array, same length as the plan):
    hit[i] = levelsHitOverride[i]
else:
    hit[i] = (mfe != null) AND (mfe >= levels[i].targetR)
```

### B4. Final R

```text
if finalROverride != null:
    finalR = finalROverride
else if mfe is missing AND levelsHitOverride is missing:
    finalR = null                                      // trade is Incomplete
else:
    remainder = remainderExitR                         // if exitReason is SL → −1, BE → 0
    if remainder is missing AND some level is not hit:
        finalR = null                                  // Incomplete
    else:
        weighted = Σ over levels i of
                   allocation[i] × ( hit[i] ? targetR[i] : remainder )
        finalR = weighted × riskR                      // riskR defaults to 1
```

### B5. Status

```text
status = "completed"  if finalR != null
status = "incomplete" otherwise
```

### B6. Win / loss / breakeven

```text
finalR > tolerance   → Win
finalR < −tolerance  → Loss
otherwise            → Breakeven          // tolerance defaults to 0
```

### B7. Core statistics (completed trades in the filtered, ordered list)

```text
total        = number of completed trades
wins, losses, breakevens as classified above
winRate      = wins / total × 100
lossRate     = losses / total × 100
totalR       = Σ finalR
avgR         = totalR / total                         // equals expectancy
medianR      = median of finalR
avgWinR      = mean of finalR over wins
avgLossR     = mean of finalR over losses (a negative number)
bestTrade    = max finalR,  worstTrade = min finalR
profitFactor = Σ finalR over wins / abs(Σ finalR over losses)
               (∞ if there are wins and no losses; — if no completed trades)
avgMFE, medianMFE = over trades that have an MFE value
avgMAE, medianMAE = over trades that have an MAE value
```

### B8. Equity curve and drawdown

```text
equity[0] = 0
equity[k] = equity[k−1] + finalR of the k-th trade in the chosen order
peak      = 0 at the start; peak = max(peak, equity[k])
drawdown[k] = peak − equity[k]                        // zero or positive
maxDrawdown = max(drawdown[k])                        // shown as a positive number of R
currentEquity = equity[last]
```

The order is the order of the filtered list: by trade number (default) or by historical date, then time, then trade number (toggle).

### B9. Streaks

Walk the ordered list. A win extends the winning streak and resets the losing streak. A loss extends the losing streak and resets the winning streak. A breakeven resets both. Report the longest of each.

### B10. Target-hit rate

```text
hitRate(T) = (number of trades with mfe >= T) / (number of trades with an MFE value) × 100
```

Computed for every threshold T selected by the user. Optionally restricted to trades with `pathComplete = true`.

### B11. Distributions

MFE ranges (default): `<1`, `1–3`, `3–6`, `6–9`, `9+`. MAE ranges (default): `0–0.25`, `0.25–0.5`, `0.5–0.75`, `0.75–1`, `>1`. Each range shows count, percentage of trades with that value, and average Final R. A value equal to a boundary belongs to the higher range.

---

# Appendix C — Exit Plan Evaluation Rules

### C1. "As recorded" mode

Group completed trades by the Exit Plan stored on each trade (identical plans group together; show the template name when all trades in a group share one). Use the Final R from Appendix B4. Label all numbers **Recorded**.

### C2. "Re-evaluate" mode (Simulated)

The user selects one or more saved Exit Plans and (optionally) filters the trades. For each selected plan `P` and each completed trade `t` that has an MFE value:

```text
if t.tradePath.pathComplete == true:
    // The unmanaged path ran until the original stop (−1R) was hit.
    // Every level at or below MFE was reached; everything else exits at −1R.
    simulatedR = Σ allocation[i] × ( mfe >= targetR[i] ? targetR[i] : −1 )  × t.riskR
    quality = Exact
else if every level of P has targetR <= t.mfe:
    // All levels were reached, so the incomplete path does not matter.
    simulatedR = Σ allocation[i] × targetR[i] × t.riskR
    quality = Exact
else:
    quality = Insufficient          // exclude from this plan's statistics
```

Rules:

- Version 1 plans have fixed stops (no breakeven or trailing rules), so a simulated trade that does not reach a level loses that part at `−1R`.
- Trades with `Insufficient` quality are excluded from that plan's statistics and counted in an "excluded trades" figure.
- Trades without an MFE value are excluded and counted.
- The same set of trades must be used for every plan in one comparison for a fair side-by-side view; if a trade is Insufficient for any selected plan, offer a switch "Compare only trades evaluable under all selected plans" (on by default).
- For each plan, compute the Appendix B7 statistics (number of trades, win rate, average R, total R, profit factor, maximum drawdown, expectancy, best trade, worst trade) from the simulated results, ordered the same way as the main equity curve.
- Show beside each plan: `evaluated N / excluded M`, and the label **Simulated**.

### C3. Future extension

When stop-management rules (breakeven after a level, trailing stops) are added to Exit Plans in a future version, they must only be evaluated on trades that have detailed `waypoints`; all other trades are `Insufficient` for such plans.

---

# Appendix D — Data Model Reference and IndexedDB Layout

### D1. Trade fields

| Field                | Type                    | Required | Notes                                                                                           |
| -------------------- | ----------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `id`                 | string                  | yes      | Unique id, for example `crypto.randomUUID()`.                                                   |
| `tradeNumber`        | integer                 | yes      | Assigned automatically, stable.                                                                 |
| `date`               | string `YYYY-MM-DD`     | yes      | Historical date.                                                                                |
| `time`               | string `HH:MM` or null  | no       | Historical time.                                                                                |
| `session`            | string or null          | no       |                                                                                                 |
| `killzone`           | string or null          | no       |                                                                                                 |
| `instrument`         | string                  | yes      |                                                                                                 |
| `direction`          | `"Long"` or `"Short"`   | yes      |                                                                                                 |
| `htfBias`            | string or null          | no       |                                                                                                 |
| `htfTimeframe`       | string or null          | no       |                                                                                                 |
| `entryTimeframe`     | string or null          | no       |                                                                                                 |
| `setup`              | string or array         | no       | One or several setup components.                                                                |
| `setupQuality`       | `"A+"`,`"A"`,`"B"`,`"C"` or null | no |                                                                                           |
| `entry`              | number                  | yes      |                                                                                                 |
| `stopLoss`           | number                  | yes      | Must be on the correct side of `entry`.                                                         |
| `riskR`              | number                  | yes      | Default `1`.                                                                                    |
| `exitPlan`           | array of `{allocation, targetR}` | yes | At least one level; allocations total 1.0.                                                  |
| `exitPlanTemplateId` | string or null          | no       | For grouping only; the stored `exitPlan` is the source of truth.                                |
| `tradePath.mfe`      | number or null          | no       | In R, positive.                                                                                 |
| `tradePath.mae`      | number or null          | no       | In R, positive.                                                                                 |
| `tradePath.pathComplete` | boolean             | yes      | Default true when exit reason is SL, otherwise false.                                           |
| `tradePath.waypoints`| array of numbers or null| no       | Optional detailed path.                                                                         |
| `remainderExitR`     | number or null          | no       | R at which any unfilled allocation closed.                                                      |
| `levelsHitOverride`  | array of booleans or null | no     | One value per Exit Plan level.                                                                  |
| `finalROverride`     | number or null          | no       | Manual Final R.                                                                                 |
| `exitReason`         | string or null          | no       | From the list in Section 17.                                                                    |
| `status`             | `"completed"` or `"incomplete"` | yes | Recalculated on every save.                                                                |
| `screenshotBefore`   | string id or null       | no       | Id in the screenshots store.                                                                    |
| `screenshotAfter`    | string id or null       | no       | Id in the screenshots store.                                                                    |
| `notes`              | string                  | no       | Short.                                                                                          |
| `dataset`            | string or null          | no       |                                                                                                 |
| `isDemo`             | boolean                 | yes      | True only for demo data.                                                                        |
| `createdAt`, `updatedAt` | ISO string          | yes      | Record keeping only; not used for historical analysis.                                          |

### D2. IndexedDB layout

Database name: `ictBacktestJournal`, with a version number and an upgrade function so future versions can migrate data.

| Object store  | Key        | Indexes                                    | Contents                                                              |
| ------------- | ---------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `trades`      | `id`       | `date`, `instrument`, `session`, `status`, `dataset`, `tradeNumber` | One record per trade.                          |
| `templates`   | `id`       | `name`                                     | Exit Plan templates.                                                  |
| `settings`    | `key`      | none                                       | Theme, visible columns, thresholds, custom lists, instrument decimals, market time zone, backup reminder, low-sample threshold, strategy rules, last export date. |
| `screenshots` | `id`       | none                                       | Compressed image blobs; trades store only the id.                     |

### D3. Settings

At minimum: theme (dark/light), visible columns, target-hit thresholds, MFE/MAE range boundaries, custom instruments, custom setups, custom sessions, instrument display decimals, optional market time zone, breakeven tolerance, low-sample threshold, backup reminder on/off, last export date, strategy rules text, last-used Exit Plan.

---

# Appendix E — Validation Rules

"Error" blocks saving. "Warning" is shown inline but does not block saving. All messages appear inline next to the field.

| Rule                                                                    | Level   |
| ----------------------------------------------------------------------- | ------- |
| Date is required and must be a valid date                               | Error   |
| Instrument is required                                                  | Error   |
| Direction is required                                                   | Error   |
| Entry and SL are required numbers                                       | Error   |
| Long: SL must be below Entry                                            | Error   |
| Short: SL must be above Entry                                           | Error   |
| `abs(Entry − SL)` must be greater than zero                             | Error   |
| Exit Plan has at least one level                                        | Error   |
| Every allocation is greater than 0                                      | Error   |
| Allocations total exactly 100% (with rounding tolerance)                | Error   |
| Every Target R is a number greater than 0                               | Error   |
| Risk (R) is a number greater than 0                                     | Error   |
| MFE and MAE, if entered, are numbers                                    | Error   |
| MFE or MAE is negative                                                  | Error   |
| Final R / Remainder Exit R, if entered, are numbers                     | Error   |
| `levelsHitOverride` length matches the number of Exit Plan levels       | Error   |
| Duplicate Target R values in one Exit Plan                              | Warning |
| Exit Plan levels not in ascending Target R order                        | Warning |
| MAE greater than 1R on a trade whose exit reason is not a wider stop    | Warning |
| Entered MFE is lower than the highest level of a level marked as hit    | Warning |
| Exit reason SL but Remainder Exit R is not −1                           | Warning |
| Imported record fails any of the above                                  | Reported in the import summary; nothing is imported if validation fails |

Never use blocking browser `alert()` boxes for validation.

---

# Appendix F — Worked Examples (use them as test cases)

### F1. Long trade, both levels reached

```text
Long NAS100, Entry 100, SL 98       → rDistance = 2
Exit Plan: 30% @ 2R, 70% @ 6R       → target prices 104 and 112
MFE = 7.2, exit reason SL (unmanaged path complete)
Levels hit: 2R yes, 6R yes
Final R = 0.30×2 + 0.70×6 = 0.6 + 4.2 = +4.8R
```

### F2. Short trade, partial plan, stopped

```text
Short EURUSD, Entry 1.1000, SL 1.1020   → rDistance = 0.0020
Exit Plan: 50% @ 2R, 50% @ 4R           → target prices 1.0960 and 1.0920
MFE = 3.1, exit reason SL → Remainder Exit R = −1
Levels hit: 2R yes, 4R no
Final R = 0.50×2 + 0.50×(−1) = +0.5R
```

### F3. Same path, different Exit Plan (Simulated)

```text
Trade F2 has pathComplete = true and MFE = 3.1.
Plan 100% @ 4R           → 4R not reached  → −1.0R
Plan 50% @ 2R / 50% @ 4R → +0.5R
Plan 25% @ 2R / 25% @ 4R / 50% @ 7R → 0.25×2 + 0.25×(−1) + 0.5×(−1) = −0.25R
```

### F4. Incomplete path

```text
Trade with MFE = 3.1 but pathComplete = false.
Plan 50% @ 2R / 50% @ 4R: 4R is not known to be reached or missed → Insufficient (excluded and counted).
Plan 100% @ 3R: every level (3R) is ≤ MFE → Exact, Final R = +3.0R.
```

### F5. Breakeven-managed trade, Levels Hit override

```text
Plan 30% @ 2R / 70% @ 6R. After 2R the stop was moved to breakeven and the remainder closed at 0R.
Unmanaged MFE later reached 8R (so MFE-derived levels hit would be both).
The user unticks the 6R level (levelsHitOverride = [true, false]), Remainder Exit R = 0.
Final R = 0.30×2 + 0.70×0 = +0.6R     (Recorded)
In Re-evaluate mode this trade uses its MFE (8R) and the plan as a fixed-stop plan: +4.8R (Simulated).
```

### F6. Statistics and drawdown

```text
Ordered Final R: +3, −1, −1, +2, −1, −1, −1, +4
Equity:          3,  2,  1,  3,  2,  1,  0,  4
Total R = 4, Avg R = 0.5, Wins 3, Losses 5, Win rate = 37.5%
Gross wins = 9, gross losses = 5, Profit factor = 1.8
Peak 3 → low 0 = Max drawdown 3R
Longest winning streak 1, longest losing streak 3
```

### F7. Day of week

```text
Date 2026-10-29 → Thursday, regardless of the device's current date or time zone.
```

---

# Appendix G — Test Checklist

Verify each item and describe the result in the README or in a self-test page.

**Calculations**

- [ ] Worked examples F1–F7 produce exactly the stated numbers.
- [ ] Allocations 33.3 / 33.3 / 33.4 are accepted as 100%; 33.3 / 33.3 / 33.3 is rejected.
- [ ] Exit Plans with 1, 2, 3, and 4+ levels calculate correct target prices (long and short) and Final R.
- [ ] Decimal R values (for example +4.7, −0.3, +5.25) are accepted and totaled correctly.
- [ ] Manual Final R override and Levels Hit override are used when present and are visibly marked.
- [ ] A reduced-risk trade (`riskR = 0.5`) scales Final R but not MFE or MAE.
- [ ] Profit factor shows `∞` with no losses and `—` with no completed trades.

**Data and persistence**

- [ ] Trades, templates, settings and screenshots survive a browser refresh.
- [ ] Add, edit, delete, and undo-delete all work and keep statistics correct.
- [ ] Editing or deleting a template does not change existing trades' Exit Plans.
- [ ] Incomplete trades are shown in the table but excluded from every statistic and chart.
- [ ] A trade with no MAE is included in R statistics but excluded from average MAE.
- [ ] JSON export followed by import (Replace) reproduces identical statistics.
- [ ] JSON import (Merge) asks before updating existing ids; invalid files import nothing.
- [ ] CSV export contains readable Exit Plan strings.
- [ ] Demo data loads with `isDemo`, clears without touching real trades, and warns when real data exists.

**Interface**

- [ ] A new trade can be recorded with only the Step 4 fields (Section 47) in under 20 seconds, using the keyboard.
- [ ] Ctrl+N, Ctrl+F, Ctrl+E, Enter, Escape and Tab behave as described.
- [ ] Filters (including MFE, MAE and Final R ranges), quick filters, search, and sorting work, and the dashboard shows `Showing X of Y trades` when filtered.
- [ ] Frozen columns stay visible while scrolling horizontally; column visibility persists.
- [ ] Inline validation appears for every rule in Appendix E; no browser alert boxes are used.
- [ ] Blind Backtest mode hides result fields and (optionally) statistics as described in Section 47.
- [ ] Dark mode is the default and the Dark/Light toggle works; negative and positive R are distinguishable without color.
- [ ] Day is correct for dates around month and year boundaries and in different device time zones.

**Analytics**

- [ ] Target-hit rates use the user-selected thresholds and show the number of trades included.
- [ ] MFE and MAE distributions and group tables (session, instrument, direction, setup, Exit Plan) match hand calculations on a small sample.
- [ ] Exit Plan Comparison shows Recorded and Simulated results separately, with evaluated and excluded counts, and excludes Insufficient trades.
- [ ] Equity curve, drawdown, current equity, best trade, worst trade, and streaks match hand calculations.

**Performance**

- [ ] With 100, 500, 1,000 and 5,000 generated trades, the table, filters, charts, and Exit Plan Comparison remain responsive.
