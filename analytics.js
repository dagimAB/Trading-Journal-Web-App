(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ICT = root.ICT || {};
    root.ICT.analytics = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const DEFAULTS = {
    sessions: ["Asia", "London", "New York AM", "New York PM", "London/NY Overlap", "Other"],
    instruments: {
      "S&P500": 2,
      NAS100: 2,
      XAUUSD: 2,
      GBPUSD: 5,
      EURUSD: 5,
    },
    setups: [
      "FVG",
      "Order Block",
      "Liquidity Sweep",
      "Breaker",
      "OTE",
      "MSS",
      "Displacement",
      "FVG + Sweep",
      "OB + Sweep",
      "Other",
    ],
    qualities: ["A+", "A", "B", "C"],
    directions: ["Long", "Short"],
    exitReasons: [
      "SL",
      "BE",
      "Target (Full)",
      "Partial Target + SL",
      "Partial Target + BE",
      "Trailing SL",
      "Manual Exit",
      "Invalidation",
      "Session End",
      "Other",
    ],
    killzones: [
      "Asian Killzone",
      "London Killzone",
      "NY AM Killzone",
      "NY PM Killzone",
      "Outside Killzone",
    ],
    htfBiases: ["Bullish", "Bearish", "Neutral"],
    timeframes: ["Monthly", "Weekly", "Daily", "4H", "1H", "15M", "5M", "1M"],
    entryTimeframes: ["Monthly", "Weekly", "Daily", "4H", "1H", "15M", "5M", "3M", "2M", "1M"],
    thresholds: [1, 2, 3, 4, 6, 9],
    mfeBoundaries: [1, 3, 6, 9],
    maeBoundaries: [0.25, 0.5, 0.75, 1],
  };

  const COLUMNS = [
    { key: "tradeNumber", label: "#", default: true, width: 62, sortable: true, sticky: 1 },
    { key: "date", label: "Date", default: true, width: 110, sortable: true, sticky: 2 },
    { key: "day", label: "Day", default: false, width: 96, derived: true },
    { key: "session", label: "Session", default: true, width: 118, sortable: true },
    { key: "killzone", label: "Killzone", default: false, width: 132 },
    { key: "instrument", label: "Instrument", default: true, width: 104, sortable: true, sticky: 3 },
    { key: "direction", label: "Dir", default: true, width: 74, sortable: true },
    { key: "setup", label: "Setup", default: true, width: 142, sortable: true },
    { key: "setupQuality", label: "Quality", default: true, width: 84 },
    { key: "htfBias", label: "HTF Bias", default: false, width: 104 },
    { key: "htfTimeframe", label: "HTF TF", default: false, width: 84 },
    { key: "entryTimeframe", label: "Entry TF", default: false, width: 88 },
    { key: "time", label: "Time", default: false, width: 78 },
    { key: "entry", label: "Entry", default: true, width: 102, sortable: true, numeric: true },
    { key: "stopLoss", label: "SL", default: true, width: 102, sortable: true, numeric: true },
    { key: "wickSl", label: "Wick SL", default: true, width: 130, sortable: true },
    { key: "bodySl", label: "Body SL", default: true, width: 130, sortable: true },
    { key: "riskR", label: "Risk", default: true, width: 74, numeric: true },
    { key: "exitPlan", label: "Exit Plan", default: true, width: 176 },
    { key: "planTemplate", label: "Plan Name", default: false, width: 132 },
    { key: "mfe", label: "MFE", default: true, width: 80, sortable: true, numeric: true },
    { key: "mae", label: "MAE", default: true, width: 80, sortable: true, numeric: true },
    { key: "remainderExitR", label: "Rem. Exit R", default: true, width: 104, numeric: true },
    { key: "finalR", label: "Result", default: true, width: 92, sortable: true, numeric: true, derived: true },
    { key: "status", label: "STATUS", default: true, width: 84, sortable: true, derived: true },
    { key: "exitReason", label: "Exit", default: true, width: 130 },
    { key: "levelsHit", label: "Levels Hit", default: true, width: 96, derived: true },
    { key: "pathComplete", label: "Path ✓", default: false, width: 84 },
    { key: "waypoints", label: "Waypoints", default: false, width: 132 },
    { key: "screenshot", label: "Shots", default: false, width: 78 },
    { key: "dataset", label: "Batch", default: false, width: 140 },
    { key: "notes", label: "Notes", default: true, width: 220 },
  ];

  const COLUMN_MAP = {};
  COLUMNS.forEach((c) => (COLUMN_MAP[c.key] = c));

  function toNum(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[+\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function clampNumber(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function rDistance(trade) {
    const entry = toNum(trade && trade.entry);
    const sl = toNum(trade && trade.stopLoss);
    if (entry === null || sl === null) return null;
    return Math.abs(entry - sl);
  }

  function targetPrice(entry, stopLoss, direction, targetR) {
    const e = toNum(entry);
    const s = toNum(stopLoss);
    const r = toNum(targetR);
    if (e === null || s === null || r === null) return null;
    const distance = Math.abs(e - s);
    return direction === "Short" ? e - distance * r : e + distance * r;
  }

  function targetPriceForTrade(trade, targetR) {
    return targetPrice(trade && trade.entry, trade && trade.stopLoss, trade && trade.direction, targetR);
  }

  function calcRr(entry, stopLoss, targetPriceVal) {
    const e = toNum(entry);
    const sl = toNum(stopLoss);
    const tp = toNum(targetPriceVal);
    if (e === null || sl === null || tp === null) return null;
    const riskDist = Math.abs(e - sl);
    const rewardDist = Math.abs(tp - e);
    if (riskDist <= 0 || rewardDist <= 0) return null;
    return clampNumber(rewardDist / riskDist, 2);
  }

  function formatRr(rr) {
    const n = toNum(rr);
    if (n === null) return "—";
    return "1:" + Number(n).toFixed(1) + "R";
  }

  function parseRrVal(val) {
    if (val === null || val === undefined || val === "") return null;
    if (typeof val === "number" && !isNaN(val)) return val;
    const str = String(val).trim();
    const m = str.match(/1\s*:\s*(-?[\d.]+)/i) || str.match(/(-?[\d.]+)/);
    if (m) {
      const n = parseFloat(m[1]);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  function parseISODate(dateStr) {
    if (typeof dateStr !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    return { year, month, day };
  }

  function dayOfWeek(dateStr) {
    const p = parseISODate(dateStr);
    if (!p) return null;
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    return DAY_NAMES[d.getUTCDay()];
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    const dp = digits === undefined ? 2 : digits;
    return clampNumber(Number(value), dp).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: dp,
    });
  }

  function formatR(value, digits) {
    const n = toNum(value);
    if (n === null) return "—";
    const dp = digits === undefined ? 2 : digits;
    const rounded = clampNumber(n, dp);
    const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
    return sign + Math.abs(rounded).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp }) + "R";
  }

  function formatSignedPlain(value, digits) {
    const n = toNum(value);
    if (n === null) return "—";
    const dp = digits === undefined ? 2 : digits;
    const rounded = clampNumber(n, dp);
    const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
    return sign + Math.abs(rounded).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
  }

  function formatPrice(value, decimals) {
    const n = toNum(value);
    if (n === null) return "—";
    const dp = decimals === undefined ? 2 : decimals;
    return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  function formatAllocation(allocation) {
    const n = toNum(allocation);
    if (n === null) return "0";
    const pct = n * 100;
    if (Math.abs(pct - Math.round(pct)) < 1e-9) return String(Math.round(pct));
    return String(clampNumber(pct, 2)).replace(/0+$/, "").replace(/\.$/, "");
  }

  function formatTargetR(targetR) {
    const n = toNum(targetR);
    if (n === null) return "0";
    return String(clampNumber(n, 4));
  }

  function planString(levels) {
    if (!Array.isArray(levels) || !levels.length) return "—";
    return levels
      .map((lvl) => formatAllocation(lvl.allocation) + "%@" + formatTargetR(lvl.targetR) + "R")
      .join(" / ");
  }

  function totalAllocation(levels) {
    if (!Array.isArray(levels)) return 0;
    return levels.reduce((sum, lvl) => sum + (toNum(lvl.allocation) || 0), 0);
  }

  function exitPlanKey(levels) {
    if (!Array.isArray(levels) || !levels.length) return "";
    return levels
      .map((lvl) => clampNumber(toNum(lvl.allocation) || 0, 6) + "@" + clampNumber(toNum(lvl.targetR) || 0, 6))
      .sort()
      .join("|");
  }

  function validateExitPlan(levels) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(levels) || levels.length === 0) {
      errors.push({ field: "exitPlan", message: "Exit Plan needs at least one level." });
      return { valid: false, errors, warnings };
    }
    levels.forEach((lvl, idx) => {
      const alloc = toNum(lvl.allocation);
      const tr = toNum(lvl.targetR);
      if (alloc === null || alloc <= 0) {
        errors.push({ field: "exitPlan", message: "Level " + (idx + 1) + ": allocation must be greater than 0%." });
      }
      if (tr === null || tr <= 0) {
        errors.push({ field: "exitPlan", message: "Level " + (idx + 1) + ": target R must be greater than 0." });
      }
    });
    if (Math.round(totalAllocation(levels) * 10000) !== 10000) {
      const shown = clampNumber(totalAllocation(levels) * 100, 2);
      errors.push({ field: "exitPlan", message: "Allocations must total exactly 100% (currently " + shown + "%)." });
    }
    const targets = levels.map((l) => toNum(l.targetR));
    const seen = new Set();
    targets.forEach((t, i) => {
      if (t === null) return;
      if (seen.has(clampNumber(t, 6))) {
        warnings.push({ field: "exitPlan", message: "Duplicate target R (" + formatTargetR(t) + "R) at level " + (i + 1) + "." });
      }
      seen.add(clampNumber(t, 6));
    });
    for (let i = 1; i < targets.length; i++) {
      if (targets[i] !== null && targets[i - 1] !== null && targets[i] < targets[i - 1]) {
        warnings.push({ field: "exitPlan", message: "Levels are not in ascending target R order." });
        break;
      }
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  function normalizeLevels(levels) {
    if (!Array.isArray(levels)) return [];
    return levels
      .map((lvl) => ({ allocation: toNum(lvl.allocation) || 0, targetR: toNum(lvl.targetR) || 0 }))
      .filter((lvl) => lvl.allocation > 0 || lvl.targetR > 0);
  }

  function levelHitState(trade) {
    const levels = normalizeLevels(trade && trade.exitPlan);
    const override = Array.isArray(trade && trade.levelsHitOverride) && trade.levelsHitOverride.length === levels.length
      ? trade.levelsHitOverride.map(Boolean)
      : null;
    const mfe = toNum(trade && trade.tradePath && trade.tradePath.mfe);
    const derived = levels.map((lvl) => mfe !== null && mfe >= lvl.targetR);
    const hit = override || derived;
    return { levels, hit, derived, override, mfe, overridden: !!override };
  }

  function levelsHitSummary(trade) {
    const state = levelHitState(trade);
    const count = state.hit.filter(Boolean).length;
    return {
      levels: state.levels,
      hit: state.hit,
      overridden: state.overridden,
      hitCount: count,
      total: state.levels.length,
      label: state.levels.length ? count + "/" + state.levels.length : "—",
    };
  }

  function derivedRemainder(trade) {
    const explicit = toNum(trade && trade.remainderExitR);
    if (explicit !== null) return explicit;
    if (trade && trade.exitReason === "SL") return -1;
    if (trade && trade.exitReason === "BE") return 0;
    return null;
  }

  function riskFactor(trade) {
    const risk = toNum(trade && trade.riskR);
    return risk !== null && risk > 0 ? risk : 1;
  }

  function finalR(trade) {
    if (!trade) return null;
    const override = toNum(trade.finalROverride);
    if (override !== null) return override;
    const state = levelHitState(trade);
    if (!state.levels.length) return null;
    if (state.mfe === null && !state.override) return null;
    const remainder = derivedRemainder(trade);
    const anyMissing = state.hit.some((h) => !h);
    if (remainder === null && anyMissing) return null;
    const weighted = state.levels.reduce((sum, lvl, i) => {
      const exitAt = state.hit[i] ? lvl.targetR : remainder === null ? 0 : remainder;
      return sum + lvl.allocation * exitAt;
    }, 0);
    return clampNumber(weighted * riskFactor(trade), 10);
  }

  function breakdown(trade) {
    const state = levelHitState(trade);
    const remainder = derivedRemainder(trade);
    const risk = riskFactor(trade);
    const levels = state.levels.map((lvl, i) => {
      const hit = state.hit[i];
      const exitR = hit ? lvl.targetR : remainder;
      return {
        index: i + 1,
        allocation: lvl.allocation,
        targetR: lvl.targetR,
        targetPrice: targetPriceForTrade(trade, lvl.targetR),
        hit,
        exitR,
        contribution: exitR === null ? null : lvl.allocation * exitR * risk,
      };
    });
    return {
      levels,
      remainder,
      risk,
      override: toNum(trade && trade.finalROverride) !== null,
      overridden: state.overridden,
      finalR: finalR(trade),
    };
  }

  function tradeStatus(trade) {
    return finalR(trade) === null ? "incomplete" : "completed";
  }

  function classify(value, tolerance) {
    const n = toNum(value);
    if (n === null) return "incomplete";
    const tol = Math.abs(toNum(tolerance) || 0);
    if (n > tol) return "win";
    if (n < -tol) return "loss";
    return "breakeven";
  }

  function statusBadge(value) {
    let n = value;
    if (n && typeof n === "object") {
      n = n.finalR !== undefined ? n.finalR : finalR(n);
    }
    n = toNum(n);
    if (n === null || n === undefined) return '<span class="muted">—</span>';
    if (Math.abs(n) < 1e-9) {
      return '<span class="pill pill-be badge-be status-be" title="Breakeven">BE</span>';
    }
    if (n > 0) {
      return '<span class="pill pill-win badge-win status-win" title="Win">WIN</span>';
    }
    return '<span class="pill pill-loss badge-loss status-loss" title="Loss">LOSS</span>';
  }
  const getStatusBadge = statusBadge;

  function setupComponents(trade) {
    const setup = trade && trade.setup;
    if (Array.isArray(setup)) return setup.map((s) => String(s).trim()).filter(Boolean);
    if (typeof setup === "string") {
      return setup
        .split(/\s*\+\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }

  function screenshotUrls(trade, kind) {
    const pluralKey = kind === "entry" ? "entryScreenshots" : "outcomeScreenshots";
    const singularKey = kind === "entry" ? "entryScreenshot" : "outcomeScreenshot";
    const seen = new Set();
    const list = [];
    const push = (value) => {
      if (typeof value !== "string") return;
      const url = value.trim();
      if (!url || seen.has(url)) return;
      seen.add(url);
      list.push(url);
    };
    if (trade && Array.isArray(trade[pluralKey])) trade[pluralKey].forEach(push);
    if (!list.length && trade && trade[singularKey]) push(trade[singularKey]);
    return list;
  }

  function decorate(trade) {
    const levels = normalizeLevels(trade && trade.exitPlan);
    const hits = levelHitState(trade);
    const result = finalR(trade);
    const wickRr = trade && trade.wickRr !== undefined && trade.wickRr !== null && trade.wickRr !== "" ? trade.wickRr : null;
    const bodyRr = trade && trade.bodyRr !== undefined && trade.bodyRr !== null && trade.bodyRr !== "" ? trade.bodyRr : null;
    return {
      ...trade,
      wickRr,
      bodyRr,
      day: dayOfWeek(trade && trade.date),
      rDistance: rDistance(trade),
      exitPlanLevels: levels,
      exitPlanLabel: planString(levels),
      targetPrices: levels.map((lvl) => targetPriceForTrade(trade, lvl.targetR)),
      levelsHit: hits.hit,
      levelsHitLabel: levels.length ? hits.hit.filter(Boolean).length + "/" + levels.length : "—",
      levelsHitOverridden: hits.overridden,
      finalR: result,
      status: result === null ? "incomplete" : "completed",
      resultStatus: result === null ? null : (Math.abs(result) < 1e-9 ? "BE" : result > 0 ? "WIN" : "LOSS"),
      statusBadge: statusBadge(result),
      outcome: classify(result),
      effectiveRemainder: derivedRemainder(trade),
      mfe: trade && trade.tradePath ? toNum(trade.tradePath.mfe) : null,
      mae: trade && trade.tradePath ? toNum(trade.tradePath.mae) : null,
      pathComplete: !!(trade && trade.tradePath && trade.tradePath.pathComplete),
      riskR: riskFactor(trade),
    };
  }

  function mean(values) {
    const clean = values.filter((v) => Number.isFinite(v));
    if (!clean.length) return null;
    return clean.reduce((a, b) => a + b, 0) / clean.length;
  }

  function median(values) {
    const clean = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
    if (!clean.length) return null;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  }

  function sortKeyTime(trade) {
    const time = trade && typeof trade.time === "string" ? trade.time : "";
    return /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "99:99";
  }

  function orderTrades(trades, orderBy) {
    const list = trades.slice();
    if (orderBy === "chronological") {
      list.sort((a, b) => {
        const da = a.date || "";
        const db = b.date || "";
        if (da !== db) return da < db ? -1 : 1;
        const ta = sortKeyTime(a);
        const tb = sortKeyTime(b);
        if (ta !== tb) return ta < tb ? -1 : 1;
        return (a.tradeNumber || 0) - (b.tradeNumber || 0);
      });
    } else {
      list.sort((a, b) => (a.tradeNumber || 0) - (b.tradeNumber || 0));
    }
    return list;
  }

  function computeStreaks(orderedTrades, tolerance) {
    let longestWin = 0;
    let longestLose = 0;
    let currentWin = 0;
    let currentLose = 0;
    for (const t of orderedTrades) {
      const outcome = classify(finalR(t), tolerance);
      if (outcome === "win") {
        currentWin += 1;
        currentLose = 0;
      } else if (outcome === "loss") {
        currentLose += 1;
        currentWin = 0;
      } else {
        currentWin = 0;
        currentLose = 0;
      }
      if (currentWin > longestWin) longestWin = currentWin;
      if (currentLose > longestLose) longestLose = currentLose;
    }
    return { longestWin, longestLose };
  }

  function equitySeries(orderedTrades) {
    const points = [];
    const equity = [];
    const drawdown = [];
    let running = 0;
    let peak = 0;
    let maxDrawdown = 0;
    orderedTrades.forEach((t, idx) => {
      running += finalR(t) || 0;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDrawdown) maxDrawdown = dd;
      equity.push(running);
      drawdown.push(dd);
      points.push({ x: idx + 1, y: running, tradeNumber: t.tradeNumber || idx + 1 });
    });
    return {
      equity,
      drawdown,
      points,
      currentEquity: running,
      peakEquity: peak,
      maxDrawdown,
    };
  }

  function computeStats(trades, options) {
    const opts = options || {};
    const tolerance = opts.breakevenTolerance;
    const completed = trades.filter((t) => finalR(t) !== null);
    const ordered = orderTrades(completed, opts.orderBy || "tradeNumber");
    const results = ordered.map((t) => finalR(t));
    const wins = [];
    const losses = [];
    const breakevens = [];
    ordered.forEach((t) => {
      const r = finalR(t);
      const c = classify(r, tolerance);
      if (c === "win") wins.push(r);
      else if (c === "loss") losses.push(r);
      else breakevens.push(r);
    });
    const total = ordered.length;
    const totalR = results.reduce((a, b) => a + b, 0);
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = losses.reduce((a, b) => a + b, 0);
    const mfeValues = ordered
      .map((t) => toNum(t.tradePath && t.tradePath.mfe))
      .filter((v) => v !== null);
    const maeValues = ordered
      .map((t) => toNum(t.tradePath && t.tradePath.mae))
      .filter((v) => v !== null);
    const curve = equitySeries(ordered);
    const streaks = computeStreaks(ordered, tolerance);
    let profitFactor = null;
    if (total > 0) {
      if (grossLoss === 0) profitFactor = grossWin > 0 ? Infinity : null;
      else profitFactor = grossWin / Math.abs(grossLoss);
    }
    return {
      total,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: total ? (wins.length / total) * 100 : null,
      lossRate: total ? (losses.length / total) * 100 : null,
      totalR,
      avgR: total ? totalR / total : null,
      expectancy: total ? totalR / total : null,
      medianR: median(results),
      avgWinR: mean(wins),
      avgLossR: mean(losses),
      grossWinR: grossWin,
      grossLossR: grossLoss,
      bestTrade: results.length ? Math.max(...results) : null,
      worstTrade: results.length ? Math.min(...results) : null,
      profitFactor,
      avgMFE: mean(mfeValues),
      medianMFE: median(mfeValues),
      mfeCount: mfeValues.length,
      avgMAE: mean(maeValues),
      medianMAE: median(maeValues),
      maeCount: maeValues.length,
      currentEquity: curve.currentEquity,
      peakEquity: curve.peakEquity,
      maxDrawdown: curve.maxDrawdown,
      equity: curve.equity,
      drawdown: curve.drawdown,
      points: curve.points,
      longestWinStreak: streaks.longestWin,
      longestLoseStreak: streaks.longestLose,
      ordered,
    };
  }

  function completedTrades(trades) {
    return trades.filter((t) => finalR(t) !== null);
  }

  function targetHitRates(trades, thresholds, options) {
    const opts = options || {};
    const base = completedTrades(trades).filter((t) => {
      const mfe = toNum(t.tradePath && t.tradePath.mfe);
      if (mfe === null) return false;
      if (opts.onlyCompletePath && !(t.tradePath && t.tradePath.pathComplete)) return false;
      return true;
    });
    return (thresholds || []).map((threshold) => {
      const hits = base.filter((t) => toNum(t.tradePath.mfe) >= threshold).length;
      return {
        threshold,
        hits,
        total: base.length,
        rate: base.length ? (hits / base.length) * 100 : null,
        excludedByPath: opts.onlyCompletePath
          ? completedTrades(trades).filter((t) => {
              const mfe = toNum(t.tradePath && t.tradePath.mfe);
              return mfe !== null && !(t.tradePath && t.tradePath.pathComplete);
            }).length
          : 0,
      };
    });
  }

  function groupValues(trade, groupBy) {
    if (typeof groupBy === "function") {
      const v = groupBy(trade);
      return Array.isArray(v) ? v : [v];
    }
    if (groupBy === "setup") {
      const comps = setupComponents(trade);
      return comps.length ? comps : ["(none)"];
    }
    const raw = trade[groupBy];
    if (Array.isArray(raw)) return raw.length ? raw : ["(none)"];
    if (raw === null || raw === undefined || raw === "") return ["(none)"];
    return [String(raw)];
  }

  function groupStats(trades, groupBy, options) {
    const map = new Map();
    const completed = completedTrades(trades);
    for (const trade of completed) {
      for (const key of groupValues(trade, groupBy)) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(trade);
      }
    }
    return Array.from(map.entries())
      .map(([key, list]) => {
        const stats = computeStats(list, options);
        return { key, trades: stats.total, stats };
      })
      .sort((a, b) => b.trades - a.trades);
  }

  function targetHitRatesByGroup(trades, groupBy, thresholds, options) {
    const opts = options || {};
    const map = new Map();
    const completed = completedTrades(trades);
    for (const trade of completed) {
      for (const key of groupValues(trade, groupBy)) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(trade);
      }
    }
    return Array.from(map.entries())
      .map(([key, list]) => ({
        key,
        total: list.length,
        rates: targetHitRates(list, thresholds, opts),
      }))
      .sort((a, b) => b.total - a.total);
  }

  function rangeLabels(boundaries, prefix) {
    const labels = [];
    const fmt = (n) => String(clampNumber(n, 4));
    labels.push("<" + fmt(boundaries[0]) + "R");
    for (let i = 0; i < boundaries.length - 1; i++) {
      labels.push(fmt(boundaries[i]) + "R–" + fmt(boundaries[i + 1]) + "R");
    }
    labels.push(fmt(boundaries[boundaries.length - 1]) + "R+");
    if (prefix === "mae") {
      labels[0] = "0R–" + fmt(boundaries[0]) + "R";
      labels[labels.length - 1] = ">" + fmt(boundaries[boundaries.length - 1]) + "R";
    }
    return labels;
  }

  function distribution(trades, boundaries, valueOf, options) {
    const opts = options || {};
    const labels = rangeLabels(boundaries, opts.kind);
    const buckets = labels.map((label) => ({ label, values: [], rValues: [] }));
    for (const trade of completedTrades(trades)) {
      const value = valueOf(trade);
      if (value === null || value === undefined) continue;
      let idx = boundaries.length;
      for (let i = 0; i < boundaries.length; i++) {
        if (value < boundaries[i]) {
          idx = i;
          break;
        }
      }
      buckets[idx].values.push(value);
      const r = finalR(trade);
      if (r !== null) buckets[idx].rValues.push(r);
    }
    const total = buckets.reduce((sum, b) => sum + b.values.length, 0);
    return buckets.map((b) => ({
      label: b.label,
      count: b.values.length,
      pct: total ? (b.values.length / total) * 100 : null,
      avgFinalR: mean(b.rValues),
    }));
  }

  function mfeDistribution(trades, boundaries, options) {
    return distribution(
      trades,
      boundaries,
      (t) => toNum(t.tradePath && t.tradePath.mfe),
      options
    );
  }

  function maeDistribution(trades, boundaries, options) {
    return distribution(
      trades,
      boundaries,
      (t) => toNum(t.tradePath && t.tradePath.mae),
      Object.assign({ kind: "mae" }, options)
    );
  }

  function recordedPlanComparison(trades, options) {
    const opts = options || {};
    const map = new Map();
    for (const trade of completedTrades(trades)) {
      const levels = normalizeLevels(trade.exitPlan);
      const key = exitPlanKey(levels) || "(empty)";
      if (!map.has(key)) {
        map.set(key, { key, levels, trades: [], templateIds: new Set(), names: new Set() });
      }
      const group = map.get(key);
      group.trades.push(trade);
      if (trade.exitPlanTemplateId) group.templateIds.add(trade.exitPlanTemplateId);
      if (trade.exitPlanTemplateName) group.names.add(trade.exitPlanTemplateName);
    }
    return Array.from(map.values())
      .map((group) => {
        const stats = computeStats(group.trades, opts);
        const name = group.names.size === 1 ? Array.from(group.names)[0] : null;
        return {
          key: group.key,
          name: name || planString(group.levels),
          levels: group.levels,
          label: "Recorded",
          stats,
          evaluated: stats.total,
          excluded: 0,
          tradeIds: group.trades.map((t) => t.id),
        };
      })
      .sort((a, b) => b.stats.totalR - a.stats.totalR);
  }

  function evaluatePlanForTrade(trade, levels, options) {
    const opts = options || {};
    const plan = normalizeLevels(levels);
    if (!plan.length) return { quality: "Insufficient", simulatedR: null };
    const mfe = toNum(trade.tradePath && trade.tradePath.mfe);
    if (mfe === null) return { quality: "NoMFE", simulatedR: null };
    const hasStopRules = !!(opts.usesStopRules && opts.requiresWaypoints);
    const waypoints = trade.tradePath && Array.isArray(trade.tradePath.waypoints) ? trade.tradePath.waypoints : null;
    if (hasStopRules && !waypoints) return { quality: "Insufficient", simulatedR: null };
    const risk = riskFactor(trade);
    if (trade.tradePath && trade.tradePath.pathComplete === true) {
      const weighted = plan.reduce((sum, lvl) => sum + lvl.allocation * (mfe >= lvl.targetR ? lvl.targetR : -1), 0);
      return { quality: "Exact", simulatedR: clampNumber(weighted * risk, 10) };
    }
    if (plan.every((lvl) => lvl.targetR <= mfe)) {
      const weighted = plan.reduce((sum, lvl) => sum + lvl.allocation * lvl.targetR, 0);
      return { quality: "Exact", simulatedR: clampNumber(weighted * risk, 10) };
    }
    return { quality: "Insufficient", simulatedR: null };
  }

  function simulatedPlanComparison(orderedTrades, plans, options) {
    const opts = options || {};
    const tolerance = opts.breakevenTolerance;
    const completed = orderTrades(
      orderedTrades.filter((t) => finalR(t) !== null),
      opts.orderBy || "tradeNumber"
    );
    const planList = (plans || []).map((plan, idx) => ({
      id: plan.id || "plan-" + idx,
      name: plan.name || planString(plan.levels),
      levels: normalizeLevels(plan.levels),
    }));
    const evaluations = planList.map((plan) =>
      completed.map((trade) => Object.assign({ tradeId: trade.id }, evaluatePlanForTrade(trade, plan.levels, opts)))
    );
    let commonTrades = null;
    if (opts.onlyCommon) {
      commonTrades = new Set();
      completed.forEach((trade, idx) => {
        if (evaluations.every((ev) => ev[idx].quality === "Exact")) commonTrades.add(trade.id);
      });
    }
    return planList.map((plan, planIdx) => {
      const rows = [];
      let excluded = 0;
      let insufficient = 0;
      let noMFE = 0;
      completed.forEach((trade, idx) => {
        const ev = evaluations[planIdx][idx];
        if (opts.onlyCommon && !commonTrades.has(trade.id)) {
          excluded += 1;
          return;
        }
        if (ev.quality !== "Exact") {
          excluded += 1;
          if (ev.quality === "NoMFE") noMFE += 1;
          else insufficient += 1;
          return;
        }
        rows.push(
          Object.assign({}, trade, {
            finalROverride: ev.simulatedR,
            levelsHitOverride: null,
            tradePath: Object.assign({}, trade.tradePath),
          })
        );
      });
      const stats = computeStats(rows, { orderBy: opts.orderBy, breakevenTolerance: tolerance });
      return {
        id: plan.id,
        name: plan.name,
        levels: plan.levels,
        label: "Simulated",
        stats,
        evaluated: stats.total,
        excluded,
        insufficient,
        noMFE,
      };
    });
  }

  function compareSlOptimization(trades, options) {
    const opts = options || {};
    const tol = Math.abs(toNum(opts.breakevenTolerance) || 0);

    const completed = (trades || []).filter((t) => finalR(t) !== null);
    if (!completed.length) {
      return {
        total: 0,
        wick: { winRate: null, totalR: 0, expectancy: null, stopOutFreq: null, wins: 0, losses: 0, breakevens: 0, stopOuts: 0 },
        body: { winRate: null, totalR: 0, expectancy: null, stopOutFreq: null, wins: 0, losses: 0, breakevens: 0, stopOuts: 0 },
        diff: { expectancy: 0, winRate: 0, totalR: 0, stopOutFreq: 0, winner: "tie", summaryText: "No completed trades to evaluate." },
        trades: [],
      };
    }

    const targetTrades = completed.map((t) => {
      const entry = toNum(t.entry);
      const sl = toNum(t.stopLoss);
      if (entry === null || sl === null) return null;
      const dir = t.direction === "Short" ? "Short" : "Long";
      const dist = Math.abs(entry - sl);
      if (dist <= 0) return null;

      const wRrVal = parseRrVal(t.wickRr);
      const bRrVal = parseRrVal(t.bodyRr);
      let wickSl = toNum(t.wickSlPrice);
      let bodySl = toNum(t.bodySlPrice);

      let ratio = 1.25;
      if (wRrVal !== null && bRrVal !== null && wRrVal > 0) {
        ratio = bRrVal / wRrVal;
      } else if (wickSl !== null && bodySl !== null) {
        const wDist = Math.abs(entry - wickSl);
        const bDist = Math.abs(entry - bodySl);
        if (wDist > 0 && bDist > 0) ratio = wDist / bDist;
      } else {
        const bodyDist = dist * 0.75;
        wickSl = sl;
        bodySl = dir === "Long" ? entry - bodyDist : entry + bodyDist;
        ratio = 1.333;
      }

      return {
        trade: t,
        entry,
        direction: dir,
        slType: t.slType || "wick",
        ratio,
        wRrVal,
        bRrVal,
        wickSl,
        bodySl,
      };
    }).filter(Boolean);

    let wickWins = 0, wickLosses = 0, wickBes = 0, wickStopOuts = 0;
    let wickRValues = [];
    let bodyWins = 0, bodyLosses = 0, bodyBes = 0, bodyStopOuts = 0;
    let bodyRValues = [];
    const comparisonRows = [];

    targetTrades.forEach(({ trade: t, entry, ratio, wRrVal, bRrVal, wickSl, bodySl, slType }) => {
      const maeR = toNum(t.tradePath && t.tradePath.mae);
      const execFinalR = finalR(t);

      let wR = 0;
      let wStopped = false;
      let bR = 0;
      let bStopped = false;

      if (wRrVal !== null && bRrVal !== null) {
        if (execFinalR > tol) {
          wR = wRrVal;
          bR = bRrVal;
          if (maeR !== null && maeR >= 1.0 / ratio) {
            bR = -1.0;
            bStopped = true;
          }
        } else if (execFinalR < -tol) {
          wR = -1.0;
          wStopped = true;
          bR = -1.0;
          bStopped = true;
        } else {
          wR = 0;
          bR = 0;
        }
      } else {
        // Fallback for price-derived evaluation
        if (slType === "wick") {
          wR = execFinalR;
          wStopped = t.exitReason === "SL" || (maeR !== null && maeR >= 1.0) || execFinalR <= -0.99;
        } else {
          if (maeR !== null && maeR >= ratio) {
            wR = -1.0;
            wStopped = true;
          } else if (t.exitReason === "SL" && (maeR === null || maeR < ratio)) {
            wR = toNum(t.wickRr) !== null ? toNum(t.wickRr) : 0;
            wStopped = false;
          } else {
            wR = execFinalR / ratio;
            wStopped = false;
          }
        }

        if (slType === "body") {
          bR = execFinalR;
          bStopped = t.exitReason === "SL" || (maeR !== null && maeR >= 1.0) || execFinalR <= -0.99;
        } else {
          const bodyThresholdInWickR = 1.0 / ratio;
          if (maeR !== null && maeR >= bodyThresholdInWickR) {
            bR = -1.0;
            bStopped = true;
          } else if (t.exitReason === "SL") {
            bR = -1.0;
            bStopped = true;
          } else {
            bR = execFinalR * ratio;
            bStopped = false;
          }
        }
      }

      wR = clampNumber(wR, 2);
      bR = clampNumber(bR, 2);

      wickRValues.push(wR);
      if (wStopped) wickStopOuts++;
      if (wR > tol) wickWins++;
      else if (wR < -tol) wickLosses++;
      else wickBes++;

      bodyRValues.push(bR);
      if (bStopped) bodyStopOuts++;
      if (bR > tol) bodyWins++;
      else if (bR < -tol) bodyLosses++;
      else bodyBes++;

      comparisonRows.push({
        trade: t,
        wickRr: t.wickRr !== null && t.wickRr !== undefined ? t.wickRr : (wR ? formatRr(wR) : "—"),
        bodyRr: t.bodyRr !== null && t.bodyRr !== undefined ? t.bodyRr : (bR ? formatRr(bR) : "—"),
        wickSlPrice: wickSl,
        bodySlPrice: bodySl,
        slType,
        wickR: wR,
        bodyR: bR,
        diffR: clampNumber(bR - wR, 2),
        wickStopped: wStopped,
        bodyStopped: bStopped,
      });
    });

    const total = targetTrades.length;
    const wickTotalR = clampNumber(wickRValues.reduce((a, b) => a + b, 0), 2);
    const bodyTotalR = clampNumber(bodyRValues.reduce((a, b) => a + b, 0), 2);
    const wickExp = total > 0 ? clampNumber(wickTotalR / total, 3) : 0;
    const bodyExp = total > 0 ? clampNumber(bodyTotalR / total, 3) : 0;
    const expDiff = clampNumber(bodyExp - wickExp, 3);
    const winRateDiff = total > 0 ? clampNumber(((bodyWins - wickWins) / total) * 100, 1) : 0;
    const stopOutDiff = total > 0 ? clampNumber(((bodyStopOuts - wickStopOuts) / total) * 100, 1) : 0;

    let winner = "tie";
    let summaryText = "Both placement methods produce identical net expectancy on this dataset.";
    if (expDiff > 0.001) {
      winner = "body";
      summaryText = `Tighter Body SL outperforms Wick SL by +${formatR(expDiff)} expectancy per trade. The amplified reward on wins outweighs the extra stop-outs.`;
    } else if (expDiff < -0.001) {
      winner = "wick";
      summaryText = `Safer Wick SL outperforms Body SL by +${formatR(Math.abs(expDiff))} expectancy per trade. Protecting against premature stop-outs generates superior long-term edge.`;
    }

    return {
      total,
      wick: {
        totalR: wickTotalR,
        expectancy: wickExp,
        winRate: total > 0 ? clampNumber((wickWins / total) * 100, 1) : null,
        stopOutFreq: total > 0 ? clampNumber((wickStopOuts / total) * 100, 1) : null,
        wins: wickWins,
        losses: wickLosses,
        breakevens: wickBes,
        stopOuts: wickStopOuts,
      },
      body: {
        totalR: bodyTotalR,
        expectancy: bodyExp,
        winRate: total > 0 ? clampNumber((bodyWins / total) * 100, 1) : null,
        stopOutFreq: total > 0 ? clampNumber((bodyStopOuts / total) * 100, 1) : null,
        wins: bodyWins,
        losses: bodyLosses,
        breakevens: bodyBes,
        stopOuts: bodyStopOuts,
      },
      diff: {
        expectancy: expDiff,
        winRate: winRateDiff,
        totalR: clampNumber(bodyTotalR - wickTotalR, 2),
        stopOutFreq: stopOutDiff,
        winner,
        summaryText,
      },
      trades: comparisonRows,
    };
  }

  function validateTrade(trade, options) {
    const opts = options || {};
    const errors = [];
    const warnings = [];
    const add = (list, field, message) => list.push({ field, message, level: list === errors ? "error" : "warning" });

    if (!parseISODate(trade && trade.date)) add(errors, "date", "A valid date (YYYY-MM-DD) is required.");
    if (!trade || !trade.instrument) add(errors, "instrument", "Instrument is required.");
    if (!trade || !trade.direction) add(errors, "direction", "Direction is required.");
    if (trade && trade.direction && trade.direction !== "Long" && trade.direction !== "Short") {
      add(errors, "direction", "Direction must be Long or Short.");
    }

    const entry = toNum(trade && trade.entry);
    const sl = toNum(trade && trade.stopLoss);
    if (entry === null) add(errors, "entry", "Entry must be a number.");
    if (sl === null) add(errors, "stopLoss", "Stop loss must be a number.");
    if (entry !== null && sl !== null) {
      if (Math.abs(entry - sl) <= 0) add(errors, "stopLoss", "Risk distance cannot be zero.");
      if (trade.direction === "Long" && sl >= entry) add(errors, "stopLoss", "For a Long trade, SL must be below Entry.");
      if (trade.direction === "Short" && sl <= entry) add(errors, "stopLoss", "For a Short trade, SL must be above Entry.");
    }

    const planCheck = validateExitPlan(trade && trade.exitPlan);
    planCheck.errors.forEach((e) => add(errors, e.field, e.message));
    planCheck.warnings.forEach((w) => add(warnings, w.field, w.message));

    const risk = toNum(trade && trade.riskR);
    if (trade && (trade.riskR === null || trade.riskR === "" || trade.riskR === undefined)) {
      add(errors, "riskR", "Risk (R) is required.");
    } else if (risk === null || risk <= 0) {
      add(errors, "riskR", "Risk (R) must be a number greater than 0.");
    }

    const mfe = trade && trade.tradePath ? trade.tradePath.mfe : null;
    const mae = trade && trade.tradePath ? trade.tradePath.mae : null;
    if (mfe !== null && mfe !== "" && mfe !== undefined) {
      if (toNum(mfe) === null) add(errors, "mfe", "MFE must be a number.");
      else if (toNum(mfe) < 0) add(errors, "mfe", "MFE cannot be negative.");
    }
    if (mae !== null && mae !== "" && mae !== undefined) {
      if (toNum(mae) === null) add(errors, "mae", "MAE must be a number.");
      else if (toNum(mae) < 0) add(errors, "mae", "MAE cannot be negative.");
    }

    if (trade && trade.finalROverride !== null && trade.finalROverride !== "" && trade.finalROverride !== undefined) {
      if (toNum(trade.finalROverride) === null) add(errors, "finalR", "Final R must be a number.");
    }
    if (trade && trade.remainderExitR !== null && trade.remainderExitR !== "" && trade.remainderExitR !== undefined) {
      if (toNum(trade.remainderExitR) === null) add(errors, "remainderExitR", "Remainder Exit R must be a number.");
    }

    if (trade && Array.isArray(trade.levelsHitOverride)) {
      const planLen = Array.isArray(trade.exitPlan) ? trade.exitPlan.length : 0;
      if (trade.levelsHitOverride.length !== planLen) {
        add(errors, "levelsHit", "Levels Hit override must have one value per Exit Plan level.");
      }
    }

    if (toNum(mae) !== null && toNum(mae) > 1 && trade && trade.exitReason === "SL") {
      add(warnings, "mae", "MAE is greater than 1R but the exit reason is SL.");
    }

    if (trade && Array.isArray(trade.levelsHitOverride) && Array.isArray(trade.exitPlan)) {
      const mfeVal = toNum(mfe);
      if (mfeVal !== null) {
        trade.exitPlan.forEach((lvl, idx) => {
          if (trade.levelsHitOverride[idx] && mfeVal < (toNum(lvl.targetR) || 0)) {
            add(warnings, "levelsHit", "A level is marked hit but MFE (" + formatR(mfeVal) + ") is below its " + formatTargetR(lvl.targetR) + "R target.");
          }
        });
      }
    }

    if (trade && trade.exitReason === "SL") {
      const remainder = toNum(trade.remainderExitR);
      if (remainder !== null && Math.abs(remainder + 1) > 1e-9) {
        add(warnings, "remainderExitR", "Exit reason is SL but Remainder Exit R is not −1R.");
      }
    }

    if (opts.requireComplete) {
      if (finalR(trade) === null) add(warnings, "finalR", "Trade is still incomplete.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  function issuesFor(issues, field) {
    return issues.filter((i) => i.field === field).map((i) => i.message);
  }

  function defaultExitPlan() {
    return [{ allocation: 1, targetR: 4 }];
  }

  function defaultTemplates() {
    return [
      {
        id: "tpl-100-4r",
        name: "Full 4R",
        levels: [{ allocation: 1, targetR: 4 }],
      },
      {
        id: "tpl-100-6r",
        name: "Full 6R",
        levels: [{ allocation: 1, targetR: 6 }],
      },
      {
        id: "tpl-50-2-4",
        name: "50/50 2R-4R",
        levels: [
          { allocation: 0.5, targetR: 2 },
          { allocation: 0.5, targetR: 4 },
        ],
      },
      {
        id: "tpl-50-3-6",
        name: "50/50 3R-6R",
        levels: [
          { allocation: 0.5, targetR: 3 },
          { allocation: 0.5, targetR: 6 },
        ],
      },
      {
        id: "tpl-333-3-6-9",
        name: "33/33/33 3R-6R-9R",
        levels: [
          { allocation: 0.333, targetR: 3 },
          { allocation: 0.333, targetR: 6 },
          { allocation: 0.334, targetR: 9 },
        ],
      },
      {
        id: "tpl-25-2-4-7",
        name: "25/25/50 2R-4R-7R",
        levels: [
          { allocation: 0.25, targetR: 2 },
          { allocation: 0.25, targetR: 4 },
          { allocation: 0.5, targetR: 7 },
        ],
      },
      {
        id: "tpl-30-70-3-6",
        name: "30/70 3R-6R",
        levels: [
          { allocation: 0.3, targetR: 3 },
          { allocation: 0.7, targetR: 6 },
        ],
      },
    ];
  }

  function defaultSettings() {
    const columns = {};
    COLUMNS.forEach((c) => (columns[c.key] = !!c.default));
    return {
      theme: "dark",
      columns,
      thresholds: DEFAULTS.thresholds.slice(),
      mfeBoundaries: DEFAULTS.mfeBoundaries.slice(),
      maeBoundaries: DEFAULTS.maeBoundaries.slice(),
      customInstruments: [],
      customSetups: [],
      customSessions: [],
      instrumentDecimals: Object.assign({}, DEFAULTS.instruments),
      marketTimeZone: "",
      autoSession: false,
      breakevenTolerance: 0,
      lowSampleThreshold: 30,
      backupReminder: true,
      lastExportDate: null,
      strategyRules: "",
      lastExitPlan: defaultExitPlan(),
      lastTemplateId: "tpl-100-4r",
      lastEntry: { date: "", instrument: "S&P500", session: "London", direction: "Long" },
      blindMode: false,
      blindHideResults: true,
      hidePanels: false,
      orderBy: "tradeNumber",
      onlyCompletePath: false,
      onlyCommonPlans: true,
      visibleAnalytics: "session",
      imgbbApiKey: "0c9d4b5806991d483ea660e4aad06717",
    };
  }

  function mergeSettings(stored) {
    const base = defaultSettings();
    const merged = Object.assign({}, base, stored || {});
    merged.columns = Object.assign({}, base.columns, (stored && stored.columns) || {});
    merged.instrumentDecimals = Object.assign({}, base.instrumentDecimals, (stored && stored.instrumentDecimals) || {});
    merged.thresholds = Array.isArray(merged.thresholds) && merged.thresholds.length ? merged.thresholds : base.thresholds;
    merged.mfeBoundaries = Array.isArray(merged.mfeBoundaries) && merged.mfeBoundaries.length ? merged.mfeBoundaries : base.mfeBoundaries;
    merged.maeBoundaries = Array.isArray(merged.maeBoundaries) && merged.maeBoundaries.length ? merged.maeBoundaries : base.maeBoundaries;
    merged.lastExitPlan = Array.isArray(merged.lastExitPlan) && merged.lastExitPlan.length ? merged.lastExitPlan : base.lastExitPlan;
    return merged;
  }

  function planPreview(levels, trade) {
    const check = validateExitPlan(levels);
    if (!check.valid) return { valid: false, finalR: null, breakdown: null };
    const synthetic = Object.assign({}, trade, { exitPlan: normalizeLevels(levels) });
    return {
      valid: true,
      finalR: finalR(synthetic),
      breakdown: breakdown(synthetic),
    };
  }

  function instrumentDecimals(name, settings) {
    const custom = settings && settings.instrumentDecimals ? settings.instrumentDecimals : {};
    if (custom && custom[name] !== undefined && custom[name] !== null && custom[name] !== "") {
      const n = parseInt(custom[name], 10);
      if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
    }
    if (DEFAULTS.instruments[name] !== undefined) return DEFAULTS.instruments[name];
    return 2;
  }

  function instrumentList(settings) {
    const custom = (settings && settings.customInstruments) || [];
    if (custom.length) return custom.slice();
    return Array.from(new Set(Object.keys(DEFAULTS.instruments)));
  }

  function setupList(settings) {
    const custom = (settings && settings.customSetups) || [];
    if (custom.length) return custom.slice();
    return DEFAULTS.setups.slice();
  }

  function sessionList(settings) {
    const custom = (settings && settings.customSessions) || [];
    if (custom.length) return custom.slice();
    return DEFAULTS.sessions.slice();
  }

  function sessionFromTime(time) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ""));
    if (!m) return null;
    const minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 1440) return null;
    if (minutes >= 18 * 60 || minutes < 2 * 60) return "Asia";
    if (minutes < 7 * 60) return "London";
    if (minutes < 10 * 60) return "London/NY Overlap";
    if (minutes < 12 * 60) return "New York AM";
    if (minutes < 17 * 60) return "New York PM";
    return "Other";
  }

  function tradeSortValue(trade, key) {
    if (key === "mfe") return toNum(trade.tradePath && trade.tradePath.mfe);
    if (key === "mae") return toNum(trade.tradePath && trade.tradePath.mae);
    if (key === "finalR" || key === "status") return finalR(trade);
    if (key === "wickSl" || key === "wickRr") return parseRrVal(trade.wickRr);
    if (key === "bodySl" || key === "bodyRr") return parseRrVal(trade.bodyRr);
    if (key === "direction") return trade.direction || "";
    if (key === "setup") return setupComponents(trade).join(", ");
    if (key === "instrument") return trade.instrument || "";
    return trade[key];
  }

  function sortTrades(trades, key, direction) {
    const dir = direction === "desc" ? -1 : 1;
    const list = trades.slice();
    list.sort((a, b) => {
      const av = tradeSortValue(a, key);
      const bv = tradeSortValue(b, key);
      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1 * dir;
      if (bv === null || bv === undefined) return -1 * dir;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
    return list;
  }

  function matchesRange(value, min, max) {
    if (min !== null && (value === null || value < min)) return false;
    if (max !== null && (value === null || value > max)) return false;
    return true;
  }

  function applyFilters(trades, filters, settings) {
    const f = filters || {};
    const tol = toNum(settings && settings.breakevenTolerance) || 0;
    const search = (f.search || "").trim().toLowerCase();
    return trades.filter((trade) => {
      if (f.dateFrom && trade.date && trade.date < f.dateFrom) return false;
      if (f.dateTo && trade.date && trade.date > f.dateTo) return false;
      if (f.instrument && trade.instrument !== f.instrument) return false;
      if (f.session && trade.session !== f.session) return false;
      if (f.direction && trade.direction !== f.direction) return false;
      if (f.setup && !setupComponents(trade).includes(f.setup)) return false;
      if (f.quality && trade.setupQuality !== f.quality) return false;
      if (f.result) {
        const outcome = classify(finalR(trade), tol);
        if (f.result !== outcome) return false;
      }
      if (f.status) {
        const status = tradeStatus(trade);
        if (f.status !== status) return false;
      }
      if (f.dataset && trade.dataset !== f.dataset) return false;
      if (f.exitPlanKey && exitPlanKey(trade.exitPlan) !== f.exitPlanKey) return false;
      if (f.mfeMin !== null && f.mfeMin !== undefined) {
        const mfe = toNum(trade.tradePath && trade.tradePath.mfe);
        if (!matchesRange(mfe, f.mfeMin, f.mfeMax)) return false;
      }
      if (f.maeMin !== null && f.maeMin !== undefined) {
        const mae = toNum(trade.tradePath && trade.tradePath.mae);
        if (!matchesRange(mae, f.maeMin, f.maeMax)) return false;
      }
      if (f.finalRMin !== null && f.finalRMin !== undefined) {
        const r = finalR(trade);
        if (!matchesRange(r, f.finalRMin, f.finalRMax)) return false;
      }
      if (f.mfeAtLeast !== null && f.mfeAtLeast !== undefined && f.mfeAtLeast !== "") {
        const mfe = toNum(trade.tradePath && trade.tradePath.mfe);
        if (mfe === null || mfe < toNum(f.mfeAtLeast)) return false;
      }
      if (search) {
        const haystack = [
          trade.notes,
          trade.instrument,
          Array.isArray(trade.setup) ? trade.setup.join(" ") : trade.setup,
          trade.dataset,
          trade.session,
          trade.exitReason,
          planString(trade.exitPlan),
          trade.htfBias,
          trade.htfTimeframe,
          trade.entryTimeframe,
          trade.setupQuality,
          trade.killzone,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function uniqueValues(trades, getter) {
    const set = new Set();
    trades.forEach((t) => {
      const v = getter(t);
      if (Array.isArray(v)) v.forEach((x) => x && set.add(x));
      else if (v !== null && v !== undefined && v !== "") set.add(v);
    });
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }

  function demoPlanPool() {
    return defaultTemplates().map((t) => t.levels);
  }

  function seededRandom(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateDemoTrades(count, options) {
    const opts = options || {};
    const rand = seededRandom(opts.seed || 20261029);
    const rnd = (min, max) => min + rand() * (max - min);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const templates = defaultTemplates();
    const instruments = Object.keys(DEFAULTS.instruments);
    const sessions = DEFAULTS.sessions.slice(0, 5);
    const setups = DEFAULTS.setups.slice(0, 9);
    const qualities = DEFAULTS.qualities;
    const reasons = DEFAULTS.exitReasons;
    const trades = [];
    const start = Date.UTC(2025, 0, 6);
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const tpl = pick(templates);
      const instrument = pick(instruments);
      const direction = rand() < 0.5 ? "Long" : "Short";
      const base = instrument.includes("USD") && !instrument.includes("XAU") || instrument === "GBPUSD" || instrument === "EURUSD" ? rnd(1.05, 1.16) : instrument === "XAUUSD" ? rnd(1900, 2600) : rnd(15000, 21000);
      const decimals = instrumentDecimals(instrument, null);
      const roundTo = (v) => Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals);
      const riskPoints = instrument.includes("USD") && instrument !== "XAUUSD" ? rnd(0.002, 0.006) : instrument === "XAUUSD" ? rnd(4, 12) : rnd(20, 80);
      const entry = roundTo(base);
      const stopLoss = roundTo(direction === "Long" ? entry - riskPoints : entry + riskPoints);
      const dayOffset = Math.floor(rand() * 320);
      const d = new Date(start + dayOffset * 86400000);
      const date = d.toISOString().slice(0, 10);
      const hour = rnd(7, 18);
      const time = String(Math.floor(hour)).padStart(2, "0") + ":" + String(Math.floor(rand() * 60)).padStart(2, "0");
      const mfe = clampNumber(Math.pow(rand(), 1.7) * 11 + rnd(0, 0.5), 2);
      const mae = clampNumber(rand() * 1.15, 2);
      const pathComplete = rand() < 0.62;
      const reason = pick(reasons);
      const lastTarget = Math.max(...tpl.levels.map((l) => l.targetR));
      let levelsHitOverride = null;
      let finalROverride = null;
      let remainderExitR = null;
      let statusCompleted = true;
      if (reason === "SL") remainderExitR = -1;
      else if (reason === "BE") remainderExitR = 0;
      else remainderExitR = clampNumber(rnd(-0.9, 1.2), 2);
      if (rand() < 0.08) {
        const hits = tpl.levels.map((l) => mfe >= l.targetR);
        const actualIdx = Math.floor(rand() * tpl.levels.length);
        levelsHitOverride = hits.map((h, idx) => (idx === actualIdx ? false : h));
        if (reason === "BE") remainderExitR = 0;
        if (remainderExitR === null) remainderExitR = 0;
      }
      if (rand() < 0.05) finalROverride = clampNumber(rnd(-1, lastTarget), 2);
      if (rand() < 0.06) statusCompleted = false;
      const targetP = targetPrice(entry, stopLoss, direction, lastTarget);
      const wickRNum = clampNumber(calcRr(entry, stopLoss, targetP) || 3.0, 1);
      const bodyRNum = clampNumber(wickRNum * 1.25, 1);
      const wickRr = formatRr(wickRNum);
      const bodyRr = formatRr(bodyRNum);
      const trade = {
        id: "demo-" + i + "-" + Math.random().toString(36).slice(2, 8),
        tradeNumber: i + 1,
        date,
        time,
        session: pick(sessions),
        killzone: pick(DEFAULTS.killzones),
        instrument,
        direction,
        htfBias: pick(DEFAULTS.htfBiases),
        htfTimeframe: pick(DEFAULTS.timeframes),
        entryTimeframe: pick(DEFAULTS.entryTimeframes.slice(4)),
        setup: pick(setups),
        setupQuality: pick(qualities),
        entry,
        stopLoss,
        wickRr,
        bodyRr,
        riskR: rand() < 0.12 ? 0.5 : 1,
        exitPlan: tpl.levels.map((l) => ({ allocation: l.allocation, targetR: l.targetR })),
        exitPlanTemplateId: tpl.id,
        exitPlanTemplateName: tpl.name,
        tradePath: {
          mfe,
          mae,
          pathComplete,
          waypoints: null,
        },
        remainderExitR,
        levelsHitOverride,
        finalROverride,
        exitReason: reason,
        screenshotBefore: null,
        screenshotAfter: null,
        entryScreenshot: null,
        outcomeScreenshot: null,
        entryScreenshots: [],
        outcomeScreenshots: [],
        notes: pick([
          "London sweep + displacement.",
          "Strong HTF bearish bias.",
          "Entered after MSS, clean FVG.",
          "Clean sweep, weak continuation.",
          "Good setup, late entry.",
          "",
        ]),
        dataset: opts.dataset || "Demo Data",
        isDemo: true,
        createdAt: new Date(now - (count - i) * 60000).toISOString(),
        updatedAt: new Date(now - (count - i) * 60000).toISOString(),
      };
      if (!statusCompleted) {
        trade.tradePath.mfe = null;
        trade.tradePath.mae = null;
        trade.remainderExitR = null;
        trade.levelsHitOverride = null;
        trade.finalROverride = null;
      }
      trades.push(trade);
    }
    return trades;
  }

  return {
    DAY_NAMES,
    DEFAULTS,
    COLUMNS,
    COLUMN_MAP,
    toNum,
    clampNumber,
    rDistance,
    targetPrice,
    targetPriceForTrade,
    parseISODate,
    dayOfWeek,
    formatNumber,
    formatR,
    formatSignedPlain,
    formatPrice,
    formatAllocation,
    formatTargetR,
    planString,
    totalAllocation,
    exitPlanKey,
    validateExitPlan,
    normalizeLevels,
    levelHitState,
    levelsHitSummary,
    derivedRemainder,
    riskFactor,
    finalR,
    breakdown,
    tradeStatus,
    statusBadge,
    getStatusBadge,
    classify,
    setupComponents,
    screenshotUrls,
    decorate,
    mean,
    median,
    orderTrades,
    computeStreaks,
    equitySeries,
    computeStats,
    completedTrades,
    targetHitRates,
    groupValues,
    groupStats,
    targetHitRatesByGroup,
    rangeLabels,
    distribution,
    mfeDistribution,
    maeDistribution,
    recordedPlanComparison,
    evaluatePlanForTrade,
    simulatedPlanComparison,
    compareSlOptimization,
    calcRr,
    formatRr,
    parseRrVal,
    validateTrade,
    issuesFor,
    defaultExitPlan,
    defaultTemplates,
    defaultSettings,
    mergeSettings,
    planPreview,
    instrumentDecimals,
    instrumentList,
    setupList,
    sessionList,
    sessionFromTime,
    sortTrades,
    applyFilters,
    uniqueValues,
    demoPlanPool,
    generateDemoTrades,
    rangeLabels,
  };
});
