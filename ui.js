(function () {
  "use strict";

  const A = window.ICT.analytics;
  const RESULT_COLUMN_KEYS = ["mfe", "mae", "remainderExitR", "finalR", "status", "exitReason", "levelsHit", "pathComplete", "waypoints", "screenshot"];
  const INLINE_FIELDS = new Set([
    "date", "time", "session", "killzone", "instrument", "direction", "setup", "setupQuality",
    "htfBias", "htfTimeframe", "entryTimeframe", "entry", "stopLoss", "wickSl", "bodySl", "spcSl", "wickRr", "bodyRr", "spcRr", "riskR", "mfe", "mae",
    "remainderExitR", "finalR", "exitReason", "pathComplete", "waypoints", "dataset", "notes",
  ]);

  let handlers = {};
  let H = {};
  let model = null;
  let wired = false;
  let charts = { equity: null, drawdown: null };
  let chartTheme = null;
  let currentPopover = null;
  let modalStack = [];
  let detailsId = null;
  let selection = new Set();
  let comparisonMode = "recorded";
  let selectedPlanIds = new Set();
  let searchTimer = null;
  let numericTimer = null;
  let virtual = { active: false, tbody: null, rows: null, cols: 0, raf: null, height: 33 };

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const val = attrs[key];
        if (val === null || val === undefined || val === false) return;
        if (key === "class") node.className = val;
        else if (key === "html") node.innerHTML = val;
        else if (key === "text") node.textContent = val;
        else if (key === "dataset") Object.assign(node.dataset, val);
        else if (key === "style" && typeof val === "object") Object.assign(node.style, val);
        else if (key.startsWith("on") && typeof val === "function") node.addEventListener(key.slice(2).toLowerCase(), val);
        else if (val === true) node.setAttribute(key, "");
        else node.setAttribute(key, val);
      });
    }
    children.flat(Infinity).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
    });
    return node;
  }

  function optionsHTML(items, selected, placeholder) {
    const list = (items || []).map((item) => (typeof item === "string" ? { value: item, label: item } : item));
    const head = placeholder ? `<option value="">${esc(placeholder)}</option>` : "";
    return head + list.map((item) => {
      const value = item.value === null || item.value === undefined ? "" : item.value;
      const sel = String(value) === String(selected === null || selected === undefined ? "" : selected) ? " selected" : "";
      return `<option value="${esc(value)}"${sel}>${esc(item.label)}</option>`;
    }).join("");
  }

  function cloneTrade(trade) {
    return JSON.parse(JSON.stringify(trade));
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function signedClass(value) {
    const n = A.toNum(value);
    if (n === null || Math.abs(n) < 1e-9) return "zero";
    return n > 0 ? "pos" : "neg";
  }

  function statusBadge(value) {
    if (A.statusBadge) return A.statusBadge(value);
    let n = value;
    if (n && typeof n === "object") n = n.finalR !== undefined ? n.finalR : (A.finalR ? A.finalR(n) : null);
    n = A.toNum(n);
    if (n === null || n === undefined) return '<span class="muted">—</span>';
    if (Math.abs(n) < 1e-9) return '<span class="pill pill-be badge-be status-be" title="Breakeven">BE</span>';
    if (n > 0) return '<span class="pill pill-win badge-win status-win" title="Win">WIN</span>';
    return '<span class="pill pill-loss badge-loss status-loss" title="Loss">LOSS</span>';
  }
  const getStatusBadge = statusBadge;

  function fmtPct(value) {
    return value === null || value === undefined ? "—" : A.formatNumber(value, 1) + "%";
  }

  function fmtPF(value) {
    if (value === null || value === undefined) return "—";
    if (value === Infinity) return "∞";
    return A.formatNumber(value, 2);
  }

  function fmtSigned(value) {
    return value === null || value === undefined ? "—" : A.formatR(value);
  }

  function fmtPrice(value, trade) {
    const decimals = A.instrumentDecimals(trade && trade.instrument, model ? model.settings : null);
    return A.formatPrice(value, decimals);
  }

  function lowSample(count) {
    const threshold = (model && model.settings && model.settings.lowSampleThreshold) || 30;
    if (!count || count >= threshold) return "";
    return `<span class="low-sample" title="Fewer than ${threshold} trades. Treat this result cautiously.">low n</span>`;
  }

  function levelDots(trade) {
    const total = trade.exitPlanLevels ? trade.exitPlanLevels.length : 0;
    let out = "";
    for (let i = 0; i < total; i++) out += `<span class="level-dot ${trade.levelsHit && trade.levelsHit[i] ? "on" : ""}"></span>`;
    return `<span class="level-dots">${out}</span>`;
  }

  function cellText(trade, key) {
    switch (key) {
      case "tradeNumber":
        return `<span class="mono">#${trade.tradeNumber || "—"}</span>${trade.isDemo ? ' <span class="pill" title="Demo data">D</span>' : ""}${trade.isCopy ? ' <span class="pill" title="Copy of another trade">C</span>' : ""}`;
      case "date": return esc(trade.date || "—");
      case "day": return esc(trade.day || "—");
      case "instrument": {
        const ins = trade.instrument || "";
        const insKey = ins.toLowerCase().replace(/[^a-z0-9]/g, "");
        const insClass = ["nas100","us500","xauusd","eurusd","gbpusd"].includes(insKey) ? " pill-ins-" + insKey : "";
        return ins ? `<span class="pill${insClass}">${esc(ins)}</span>` : "—";
      }
      case "session": {
        const ses = trade.session || "";
        const sesKey = ses.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const sesMap = { "asia": "asia", "london": "london", "new-york-am": "nyam", "new-york-pm": "nypm" };
        const sesClass = sesMap[sesKey] ? " pill-ses-" + sesMap[sesKey] : "";
        return ses ? `<span class="pill${sesClass}">${esc(ses)}</span>` : "—";
      }
      case "killzone": return esc(trade.killzone || "—");
      case "direction":
        return trade.direction === "Long" ? '<span class="pos">Long</span>' : trade.direction === "Short" ? '<span class="neg">Short</span>' : "—";
      case "setup": return esc(A.setupComponents(trade).join(" + ") || "—");
      case "setupQuality": return trade.setupQuality ? `<span class="pill">${esc(trade.setupQuality)}</span>` : "—";
      case "htfBias": return esc(trade.htfBias || "—");
      case "htfTimeframe": return esc(trade.htfTimeframe || "—");
      case "entryTimeframe": return esc(trade.entryTimeframe || "—");
      case "time": return esc(trade.time || "—");
      case "entry": return fmtPrice(trade.entry, trade);
      case "stopLoss": return fmtPrice(trade.stopLoss, trade);
      case "wickSl":
      case "wickRr": {
        const val = trade.wickRr;
        if (val === null || val === undefined || val === "") return '<span class="muted">—</span>';
        return esc(String(val));
      }
      case "bodySl":
      case "bodyRr": {
        const val = trade.bodyRr;
        if (val === null || val === undefined || val === "") return '<span class="muted">—</span>';
        return esc(String(val));
      }
      case "spcSl":
      case "spcRr": {
        const val = trade.spcSl;
        if (val === null || val === undefined || val === "") return '<span class="muted">—</span>';
        return esc(String(val));
      }
      case "riskR": return A.formatNumber(trade.riskR, 2);
      case "exitPlan":
        return `<span class="plan-cell" data-action="plan" title="Edit Exit Plan">${levelDots(trade)}<span>${esc(trade.exitPlanLabel || "—")}</span></span>`;
      case "planTemplate": {
        const tpl = model.templates.find((t) => t.id === trade.exitPlanTemplateId);
        return esc(tpl ? tpl.name : trade.exitPlanTemplateName || "—");
      }
      case "mfe":
        return trade.mfe === null || trade.mfe === undefined ? '<span class="muted">—</span>' : `<span class="num">${esc(A.formatNumber(trade.mfe, 2))}R</span>`;
      case "mae":
        return trade.mae === null || trade.mae === undefined ? '<span class="muted">—</span>' : `<span class="num">${esc(A.formatNumber(trade.mae, 2))}R</span>`;
      case "remainderExitR":
        return trade.effectiveRemainder === null || trade.effectiveRemainder === undefined
          ? '<span class="muted">—</span>'
          : `<span class="num ${signedClass(trade.effectiveRemainder)}">${esc(A.formatR(trade.effectiveRemainder))}</span>`;
      case "finalR":
        if (trade.finalR === null || trade.finalR === undefined) return '<span class="muted">—</span>';
        return `<span class="num ${signedClass(trade.finalR)}">${esc(A.formatR(trade.finalR))}</span>${A.toNum(trade.finalROverride) !== null ? '<span class="override-flag" title="Manual Final R override">OVR</span>' : ""}`;
      case "status":
        return statusBadge(trade.finalR);
      case "exitReason": return esc(trade.exitReason || "—");
      case "levelsHit":
        return `<span class="mono">${esc(trade.levelsHitLabel || "—")}</span>${trade.levelsHitOverridden ? '<span class="override-flag" title="Levels Hit override active">OVR</span>' : ""}`;
      case "pathComplete":
        return trade.pathComplete ? '<span class="pos" title="Replay reached the original stop-loss">✓</span>' : '<span class="muted">—</span>';
      case "waypoints": {
        const wp = trade.tradePath && trade.tradePath.waypoints;
        return wp && wp.length ? esc(wp.join(", ")) : '<span class="muted">—</span>';
      }
      case "screenshot": {
        const count = trade.screenshotCount || 0;
        if (count) return `<span class="pill pill-accent" title="${count} screenshot(s)">${count}</span>`;
        const b = trade.screenshotBefore ? '<span class="pill pill-accent" title="Before screenshot">B</span>' : "";
        const a = trade.screenshotAfter ? '<span class="pill" title="After screenshot">A</span>' : "";
        return b || a ? `<span class="inline-actions">${b}${a}</span>` : '<span class="muted">—</span>';
      }
      case "dataset": return esc(trade.dataset || "—");
      case "notes": return `<span class="notes-cell" title="${esc(trade.notes || "")}">${esc(trade.notes || "")}</span>`;
      default: return esc(trade[key] === null || trade[key] === undefined ? "—" : trade[key]);
    }
  }

  function isColumnVisible(key, settings, blind) {
    if (key === "tradeNumber") return true;
    if (settings && settings.columns) {
      if (settings.columns[key] === false) return false;
      if (settings.columns[key] === true) {
        if (blind && settings.blindHideResults && RESULT_COLUMN_KEYS.includes(key)) return false;
        return true;
      }
    }
    const colDef = A.COLUMNS.find((c) => c.key === key);
    if (!colDef || !colDef.default) return false;
    if (blind && settings && settings.blindHideResults && RESULT_COLUMN_KEYS.includes(key)) return false;
    return true;
  }

  function visibleColumns() {
    return A.COLUMNS.filter((col) => isColumnVisible(col.key, model.settings, model.blind));
  }

  function stickyOffsets(columns) {
    const offsets = {};
    let left = 34;
    columns.forEach((col) => {
      if (col.sticky) {
        offsets[col.key] = left;
        left += col.width;
      }
    });
    return offsets;
  }

  function rowHTML(trade, columns, offsets) {
    const cells = columns.map((col) => {
      const editable = INLINE_FIELDS.has(col.key);
      const right = col.numeric ? " right" : "";
      const center = col.key === "levelsHit" || col.key === "pathComplete" || col.key === "screenshot" || col.key === "status" ? " center" : "";
      const sticky = offsets[col.key] !== undefined;
      const style = sticky ? ` style="left:${offsets[col.key]}px"` : "";
      const field = editable ? ` data-field="${col.key}"` : "";
      const title = col.key === "mfe"
        ? ' title="Maximum favorable excursion on the unmanaged path before the original stop. Continue the replay until the stop would have been hit for a complete path."'
        : col.key === "finalR" ? ' title="Calculated from the Exit Plan. Click to set a manual override."'
        : col.key === "status" ? ' title="Trade Status (Win / Loss / Breakeven)"'
        : col.key === "wickSl" || col.key === "wickRr" ? ' title="Wick Stop-Loss R:R"'
        : col.key === "bodySl" || col.key === "bodyRr" ? ' title="Body Stop-Loss R:R"'
        : col.key === "spcSl" || col.key === "spcRr" ? ' title="Space Stop-Loss R:R"' : "";
      const cellContent = col.key === "status" ? statusBadge(trade.finalR) : cellText(trade, col.key);
      return `<td class="num${right}${center}${sticky ? " sticky" : ""}"${style}${field}${title}>${cellContent}</td>`;
    }).join("");
    const rowClass = [trade.isDemo ? "is-demo" : "", trade.status === "incomplete" ? "incomplete" : "", selection.has(trade.id) ? "is-selected" : ""].filter(Boolean).join(" ");
    const checked = selection.has(trade.id) ? " checked" : "";
    const completeBtn = trade.status === "incomplete" ? '<button class="icon-btn" data-action="complete" title="Complete trade">✓</button>' : "";
    return `<tr data-id="${esc(trade.id)}" class="${rowClass}">
      <td class="select-cell sticky" style="left:0"><input type="checkbox" data-select="1"${checked} aria-label="Select trade ${esc(trade.tradeNumber)}"></td>
      ${cells}
      <td class="row-actions">
        <button class="icon-btn" data-action="details" title="Open details">›</button>
        ${completeBtn}
        <button class="icon-btn" data-action="duplicate" title="Duplicate trade">⧉</button>
        <button class="icon-btn danger" data-action="delete" title="Delete trade">×</button>
      </td>
    </tr>`;
  }

  function updateSelectionUI() {
    const info = byId("selection-info");
    const apply = byId("btn-apply-template");
    const clear = byId("btn-clear-selection");
    if (selection.size) {
      info.hidden = false;
      info.textContent = `${selection.size} selected`;
      apply.disabled = false;
      clear.hidden = false;
    } else {
      info.hidden = true;
      apply.disabled = true;
      clear.hidden = true;
    }
  }

  function renderTable() {
    const scroll = byId("table-scroll");
    const table = byId("trade-table");
    const colgroup = byId("trade-colgroup");
    const thead = byId("trade-thead");
    const tbody = byId("trade-tbody");
    const empty = byId("empty-state");

    const trades = model.tableTrades;
    const columns = visibleColumns();
    const offsets = stickyOffsets(columns);
    const ids = new Set(trades.map((t) => t.id));
    selection = new Set(Array.from(selection).filter((id) => ids.has(id)));

    table.style.width = 34 + columns.reduce((sum, c) => sum + c.width, 0) + 88 + "px";
    colgroup.innerHTML = '<col style="width:34px">' + columns.map((c) => `<col style="width:${c.width}px">`).join("") + '<col style="width:88px">';

    if (!model.allTrades.length) {
      scroll.hidden = true;
      empty.hidden = false;
      byId("table-count").textContent = "";
      updateSelectionUI();
      return;
    }
    scroll.hidden = false;
    empty.hidden = true;

    const allSelected = trades.length > 0 && trades.every((t) => selection.has(t.id));
    const sortKey = model.sort.key;
    const sortDir = model.sort.dir === "desc" ? "▼" : "▲";
    const headCells = columns.map((col) => {
      const sortable = !!col.sortable;
      const sticky = offsets[col.key] !== undefined;
      const style = sticky ? ` style="left:${offsets[col.key]}px"` : "";
      const right = col.numeric ? " right" : "";
      const sorted = sortable && sortKey === col.key ? " sorted" : "";
      const arrow = sortable ? `<span class="sort-arrow">${sortKey === col.key ? sortDir : "↕"}</span>` : "";
      return `<th class="${sortable ? "sortable" : ""}${right}${sticky ? " sticky" : ""}${sorted}"${style}${sortable ? ` data-sort="${col.key}"` : ""}>${esc(col.label)}${arrow}</th>`;
    }).join("");

    thead.innerHTML = `<tr>
      <th class="select-cell sticky" style="left:0"><input type="checkbox" id="select-all"${allSelected ? " checked" : ""} aria-label="Select all trades"></th>
      ${headCells}
      <th class="center">Actions</th>
    </tr>`;
    const master = byId("select-all");
    if (master) master.indeterminate = selection.size > 0 && !allSelected;

    byId("table-count").textContent =
      (model.filteredTrades.length === model.allTrades.length ? `${trades.length} trade${trades.length === 1 ? "" : "s"}` : `${trades.length} of ${model.allTrades.length} trades`) +
      (model.blind && model.settings.blindHideResults ? " · results hidden" : "");

    virtual.active = trades.length > 400;
    virtual.tbody = tbody;
    virtual.rows = trades;
    virtual.cols = columns.length + 2;
    virtual.height = 33;

    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="${columns.length + 2}" class="center muted" style="padding:26px 10px">No trades match the active filters.</td></tr>`;
      updateSelectionUI();
      return;
    }

    virtual.drawWindow = function () {
      if (!virtual.active) {
        tbody.innerHTML = trades.map((t) => rowHTML(t, columns, offsets)).join("");
        return;
      }
      const rowH = virtual.height;
      const viewport = scroll.clientHeight || 500;
      const start = Math.max(0, Math.floor(scroll.scrollTop / rowH) - 6);
      const end = Math.min(trades.length, start + Math.ceil(viewport / rowH) + 14);
      const rows = [];
      if (start > 0) rows.push(`<tr class="vpad"><td colspan="${virtual.cols}" style="height:${start * rowH}px"></td></tr>`);
      for (let i = start; i < end; i++) rows.push(rowHTML(trades[i], columns, offsets));
      if (end < trades.length) rows.push(`<tr class="vpad"><td colspan="${virtual.cols}" style="height:${(trades.length - end) * rowH}px"></td></tr>`);
      tbody.innerHTML = rows.join("");
    };

    if (virtual.active && scroll.scrollTop > trades.length * virtual.height) scroll.scrollTop = 0;
    virtual.drawWindow();
    scroll.onscroll = virtual.active ? function () {
      if (virtual.raf) return;
      virtual.raf = requestAnimationFrame(() => {
        virtual.raf = null;
        virtual.drawWindow();
      });
    } : null;

    updateSelectionUI();
  }

  function renderDashboard() {
    const stats = model.stats;
    const filtered = model.filteredTrades;
    const completed = stats.total;
    const threshold = model.settings.lowSampleThreshold || 30;
    const cards = byId("dash-cards");
    const secondary = byId("dash-secondary");

    const pfSub = stats.grossLossR === 0
      ? `${A.formatNumber(stats.grossWinR, 2)}R gross win`
      : `${A.formatNumber(stats.grossWinR, 2)}R / ${A.formatNumber(Math.abs(stats.grossLossR), 2)}R`;
    const cardsData = [
      { label: "Total Trades", value: String(completed), sub: `${filtered.length - completed} incomplete`, cls: "" },
      { label: "Win Rate", value: stats.winRate === null ? "—" : fmtPct(stats.winRate), sub: `${stats.wins}W / ${stats.losses}L / ${stats.breakevens}BE`, cls: "" },
      { label: "Total R", value: fmtSigned(stats.totalR), sub: `current ${fmtSigned(stats.currentEquity)}`, cls: signedClass(stats.totalR) },
      { label: "Avg R", value: fmtSigned(stats.avgR), sub: "expectancy", cls: signedClass(stats.avgR) },
      { label: "Profit Factor", value: fmtPF(stats.profitFactor), sub: pfSub, cls: "" },
      { label: "Max Drawdown", value: stats.maxDrawdown === null ? "—" : `${A.formatNumber(stats.maxDrawdown, 2)}R`, sub: `peak ${fmtSigned(stats.peakEquity)}`, cls: stats.maxDrawdown > 0 ? "neg" : "" },
    ];
    cards.innerHTML = cardsData.map((card) => `<div class="dash-card">
      <div class="dash-card-label">${esc(card.label)}</div>
      <div class="dash-card-value ${card.cls}">${esc(card.value)}</div>
      <div class="dash-card-sub">${esc(card.sub)}</div>
    </div>`).join("");

    byId("low-sample-flag").hidden = !(completed > 0 && completed < threshold);
    byId("low-sample-flag").textContent = `Low sample size · ${completed} of ${threshold}`;

    const summary = byId("filter-summary");
    if (!model.allTrades.length) summary.textContent = "No trades recorded yet";
    else if (filtered.length === model.allTrades.length) summary.textContent = `${model.allTrades.length} trades · ${completed} completed`;
    else summary.textContent = `Showing ${filtered.length} of ${model.allTrades.length} trades · ${completed} completed`;

    if (!completed) {
      secondary.innerHTML = "";
      return;
    }
    const hits = A.targetHitRates(filtered, model.settings.thresholds, { onlyCompletePath: model.settings.onlyCompletePath });
    secondary.innerHTML = [
      `<span class="mini"><span>Avg MFE</span><b>${stats.avgMFE === null ? "—" : A.formatNumber(stats.avgMFE, 2) + "R"}</b></span>`,
      `<span class="mini"><span>Median MFE</span><b>${stats.medianMFE === null ? "—" : A.formatNumber(stats.medianMFE, 2) + "R"}</b></span>`,
      `<span class="mini"><span>Avg MAE</span><b>${stats.avgMAE === null ? "—" : A.formatNumber(stats.avgMAE, 2) + "R"}</b></span>`,
      `<span class="mini"><span>Median MAE</span><b>${stats.medianMAE === null ? "—" : A.formatNumber(stats.medianMAE, 2) + "R"}</b></span>`,
      `<span class="mini"><span>Best / Worst</span><b>${fmtSigned(stats.bestTrade)} / ${fmtSigned(stats.worstTrade)}</b></span>`,
      `<span class="mini"><span>Streaks</span><b>${stats.longestWinStreak}W · ${stats.longestLoseStreak}L</b></span>`,
    ].concat(hits.map((rate) => `<span class="mini"><span>${A.formatTargetR(rate.threshold)}R hit</span><b>${rate.rate === null ? "—" : fmtPct(rate.rate)}</b><span class="faint">${rate.hits}/${rate.total}</span></span>`)).join("");
  }

  function chartColors() {
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => (css.getPropertyValue(name) || fallback).trim();
    return {
      grid: pick("--border-soft", "#24324a"),
      tick: pick("--muted", "#94a3b8"),
      text: pick("--text", "#f8fafc"),
      accent: pick("--accent", "#60a5fa"),
      accentRgb: pick("--accent-rgb", "96, 165, 250").replace(/\s+/g, ""),
      neg: pick("--neg", "#f87171"),
      negRgb: pick("--neg-rgb", "248, 113, 113").replace(/\s+/g, ""),
      panel: pick("--panel", "#111827"),
      border: pick("--border", "#334155"),
    };
  }

  function buildChart(canvas, negative) {
    if (!window.Chart) return null;
    const ctx = canvas.getContext("2d");
    const colors = chartColors();
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 220);
    gradient.addColorStop(0, negative ? `rgba(${colors.negRgb}, 0.20)` : `rgba(${colors.accentRgb}, 0.18)`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    const stroke = negative ? colors.neg : colors.accent;
    return new window.Chart(ctx, {
      type: "line",
      data: { datasets: [{
        data: [],
        borderColor: stroke,
        backgroundColor: negative ? `rgba(${colors.negRgb}, 0.10)` : gradient,
        borderWidth: 1.8,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBackgroundColor: stroke,
        pointHoverBorderColor: colors.panel,
        tension: 0.15,
        fill: true,
      }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colors.panel,
            borderColor: colors.border,
            borderWidth: 1,
            titleColor: colors.text,
            bodyColor: colors.text,
            padding: 8,
            displayColors: false,
            callbacks: {
              title: (items) => {
                const p = items[0] ? items[0].raw : null;
                return p ? `Trade position ${p.x}${p.tradeNumber ? " · #" + p.tradeNumber : ""}` : "";
              },
              label: (item) => (negative ? "Drawdown " : "Equity ") + A.formatR(item.raw.y),
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            grid: { color: colors.grid, drawTicks: false },
            border: { color: colors.border },
            ticks: { color: colors.tick, maxTicksLimit: 12, precision: 0, padding: 4 },
          },
          y: {
            grid: { color: colors.grid, drawTicks: false },
            border: { color: colors.border },
            ticks: {
              color: colors.tick,
              maxTicksLimit: 6,
              padding: 6,
              callback: (value) => {
                const n = Number(value);
                const sign = n > 0 ? "+" : n < 0 ? "−" : "";
                return sign + Math.abs(n) + "R";
              },
            },
          },
        },
      },
    });
  }

  function renderCharts() {
    if (!window.Chart) return;
    const themeKey = model.settings.theme + "|" + model.blind;
    if (chartTheme !== themeKey) {
      if (charts.equity) charts.equity.destroy();
      if (charts.drawdown) charts.drawdown.destroy();
      charts.equity = buildChart(byId("equity-chart"), false);
      charts.drawdown = buildChart(byId("drawdown-chart"), true);
      chartTheme = themeKey;
    }
    const stats = model.stats;
    if (charts.equity) {
      charts.equity.data.datasets[0].data = stats.points.map((p) => ({ x: p.x, y: p.y, tradeNumber: p.tradeNumber }));
      charts.equity.update("none");
    }
    if (charts.drawdown) {
      charts.drawdown.data.datasets[0].data = stats.drawdown.map((y, i) => ({ x: i + 1, y, tradeNumber: stats.ordered[i] ? stats.ordered[i].tradeNumber : null }));
      charts.drawdown.update("none");
    }
    byId("curve-stats").innerHTML = [
      `<span>Equity <b class="${signedClass(stats.currentEquity)}">${fmtSigned(stats.currentEquity)}</b></span>`,
      `<span>Best <b class="pos">${fmtSigned(stats.bestTrade)}</b></span>`,
      `<span>Worst <b class="neg">${fmtSigned(stats.worstTrade)}</b></span>`,
      `<span>Max DD <b class="neg">${stats.maxDrawdown === null ? "—" : A.formatNumber(stats.maxDrawdown, 2) + "R"}</b></span>`,
    ].join("");
  }

  function exitPlanOptions() {
    const map = new Map();
    model.allTrades.forEach((trade) => {
      const key = A.exitPlanKey(trade.exitPlan);
      if (!key) return;
      if (!map.has(key)) map.set(key, { levels: trade.exitPlan, labels: new Set() });
      map.get(key).labels.add(trade.exitPlanTemplateName || A.planString(trade.exitPlan));
    });
    model.templates.forEach((tpl) => {
      const key = A.exitPlanKey(tpl.levels);
      if (!key) return;
      if (!map.has(key)) map.set(key, { levels: tpl.levels, labels: new Set() });
      map.get(key).labels.add(tpl.name);
    });
    return Array.from(map.entries())
      .map(([key, value]) => ({ value: key, label: value.labels.size === 1 ? Array.from(value.labels)[0] : A.planString(value.levels) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  function uniqueFromTrades(key) {
    return A.uniqueValues(model.allTrades, (trade) => {
      const v = trade[key];
      if (Array.isArray(v)) return v;
      return v === undefined || v === null || v === "" ? null : v;
    });
  }

  function setSelectOptions(select, items, placeholder, value) {
    select.innerHTML = optionsHTML(items, value, placeholder);
    if (value !== null && value !== undefined && value !== "") select.value = value;
  }

  function renderFilters() {
    const filters = model.filters;
    const instrumentList = A.uniqueValues(model.allTrades.concat([{ instrument: "" }]), (t) => t.instrument || null);
    setSelectOptions(byId("filter-instrument"), A.instrumentList(model.settings), "All instruments", filters.instrument || "");
    setSelectOptions(byId("filter-session"), A.sessionList(model.settings), "All sessions", filters.session || "");
    setSelectOptions(byId("filter-setup"), A.setupList(model.settings), "Any setup", filters.setup || "");
    setSelectOptions(byId("filter-dataset"), uniqueFromTrades("dataset"), "All batches", filters.dataset || "");
    setSelectOptions(byId("filter-exit-plan"), exitPlanOptions(), "Any Exit Plan", filters.exitPlanKey || "");

    byId("filter-result").value = filters.result || "";
    byId("filter-quality").value = filters.quality || "";
    byId("filter-status").value = filters.status || "";
    byId("filter-date-from").value = filters.dateFrom || "";
    byId("filter-date-to").value = filters.dateTo || "";
    const numFields = [
      ["filter-mfe-min", filters.mfeMin], ["filter-mfe-max", filters.mfeMax],
      ["filter-mae-min", filters.maeMin], ["filter-mae-max", filters.maeMax],
      ["filter-final-min", filters.finalRMin], ["filter-final-max", filters.finalRMax],
    ];
    numFields.forEach(([id, value]) => { byId(id).value = value === null || value === undefined ? "" : value; });
    const search = byId("search-input");
    if (document.activeElement !== search) search.value = filters.search || "";

    const result = filters.result || "";
    document.querySelectorAll("#quick-filters .chip").forEach((chip) => {
      const quick = chip.dataset.quick;
      const active = quick === "all"
        ? !result && !filters.mfeAtLeast
        : quick === result && (quick === "breakeven" || !filters.mfeAtLeast);
      chip.classList.toggle("active", active);
    });
    byId("quick-mfe-atleast").value = filters.mfeAtLeast === null || filters.mfeAtLeast === undefined ? "" : String(filters.mfeAtLeast);

    const advancedKeys = ["dateFrom", "dateTo", "setup", "quality", "status", "exitPlanKey", "mfeMin", "mfeMax", "maeMin", "maeMax", "finalRMin", "finalRMax"];
    const activeAdvanced = advancedKeys.filter((k) => filters[k] !== null && filters[k] !== undefined && filters[k] !== "").length;
    const badge = byId("filter-badge");
    badge.hidden = activeAdvanced === 0;
    badge.textContent = String(activeAdvanced);

    byId("columns-list").innerHTML = A.COLUMNS.map((col) => {
      const locked = col.key === "tradeNumber";
      return `<label class="column-check${locked ? " frozen" : ""}" title="${locked ? "Always visible" : ""}">
        <input type="checkbox" data-column="${col.key}"${model.settings.columns[col.key] ? " checked" : ""}${locked ? " disabled" : ""}>
        ${esc(col.label)}${col.sticky ? " · frozen" : ""}
      </label>`;
    }).join("");
  }

  function renderBackup() {
    const banner = byId("backup-reminder");
    if (!model.backupDue) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML = `<span>You haven't exported a backup in ${model.backupDays} days.</span>
      <span class="inline-actions" style="margin-left:auto">
        <button type="button" class="btn btn-small" data-backup="export">Export now</button>
        <button type="button" class="btn btn-ghost btn-small" data-backup="disable">Disable reminder</button>
      </span>`;
  }

  function renderBlindBanner() {
    const banner = byId("blind-banner");
    banner.hidden = !model.blind;
    if (!model.blind) return;
    banner.innerHTML = `<strong>Blind backtest mode</strong>
      <span>New trades capture entry data only. Complete results afterwards with the Complete action.</span>
      <label class="switch" style="margin-left:auto">
        <input type="checkbox" id="blind-hide-toggle"${model.settings.blindHideResults ? " checked" : ""}>
        Hide results, dashboard and curves
      </label>`;
  }

  function setTheme() {
    const theme = model.settings.theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", theme === "light" ? "#f1f5f9" : "#0b1120");
    byId("theme-icon").textContent = theme === "light" ? "☾" : "☀";
    byId("btn-blind").classList.toggle("is-active", !!model.blind);
    document.body.classList.toggle("blind-hide", !!(model.blind && model.settings.blindHideResults));
  }

  function setPanelVisibility() {
    const isMissed = model && model.view === "missed";
    const hidden = !!(model && model.settings && model.settings.hidePanels);
    document.body.classList.toggle("panels-hidden", hidden);
    const btn = byId("btn-hide-panels");
    if (btn) {
      btn.hidden = isMissed;
      btn.textContent = hidden ? "Show Panels" : "Hide Panels";
      btn.setAttribute("aria-pressed", hidden ? "true" : "false");
      btn.classList.toggle("is-active", hidden);
    }
  }

  function renderFooter() {
    const completed = model.allTrades.filter((t) => A.finalR(t) !== null).length;
    const demo = model.allTrades.filter((t) => t.isDemo).length;
    byId("footer-status").textContent = `${model.allTrades.length} trades · ${completed} completed${demo ? ` · ${demo} demo` : ""}${
      model.settings.lastExportDate ? ` · last backup ${String(model.settings.lastExportDate).slice(0, 10)}` : " · no backup yet"
    }`;
    byId("footer-version").textContent = "v1.0";
  }

  function closePopover() {
    if (!currentPopover) return;
    const pop = currentPopover;
    pop.el.hidden = true;
    currentPopover = null;
    if (pop.el.id === "btn-advanced-filters" || pop.anchor) {
      const anchor = pop.anchor;
      if (anchor) anchor.setAttribute("aria-expanded", "false");
    }
    if (pop.onClose) pop.onClose();
  }

  function openPopover(el, anchor, options) {
    if (currentPopover && currentPopover.el === el) {
      closePopover();
      return;
    }
    closePopover();
    el.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - width - 12);
    left = Math.max(12, left);
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 12 && rect.top - height - 6 > 12) top = rect.top - height - 6;
    el.style.left = left + "px";
    el.style.top = Math.max(12, top) + "px";
    currentPopover = { el, anchor, onClose: options && options.onClose };
    if (anchor) anchor.setAttribute("aria-expanded", "true");
  }

  function renderColumnsPopover() {
    byId("columns-list").innerHTML = A.COLUMNS.map((col) => {
      const locked = col.key === "tradeNumber";
      const isChecked = model.settings.columns && model.settings.columns[col.key] !== undefined
        ? !!model.settings.columns[col.key]
        : !!col.default;
      return `<label class="column-check${locked ? " frozen" : ""}" title="${locked ? "Always visible" : ""}">
        <input type="checkbox" data-column="${col.key}"${isChecked ? " checked" : ""}${locked ? " disabled" : ""}>
        ${esc(col.label)}${col.sticky ? " · frozen" : ""}
      </label>`;
    }).join("");
  }

  function render() {
    setTheme();
    setPanelVisibility();

    // Auth header state
    const signinBtn = byId("btn-auth-signin");
    const signupBtn = byId("btn-auth-signup");
    const userBadge = byId("auth-user-badge");
    const signoutBtn = byId("btn-auth-signout");
    const user = model && model.user;
    if (signinBtn && signupBtn && userBadge && signoutBtn) {
      if (user) {
        signinBtn.hidden = true;
        signupBtn.hidden = true;
        userBadge.hidden = false;
        userBadge.textContent = user.email || "Account";
        userBadge.title = `Signed in as ${user.email}`;
        signoutBtn.hidden = false;
      } else {
        signinBtn.hidden = false;
        signupBtn.hidden = false;
        userBadge.hidden = true;
        signoutBtn.hidden = true;
      }
    }

    // Migration banner state
    const migBanner = byId("migration-banner");
    const migMsg = byId("migration-message");
    if (migBanner && migMsg) {
      if (model && model.migrationAvailable && model.migrationAvailable.hasData && user) {
        const { tradesCount, missedCount } = model.migrationAvailable;
        migMsg.innerHTML = `<strong>Local data detected:</strong> Found ${tradesCount} trade${tradesCount === 1 ? "" : "s"} and ${missedCount} missed trade${missedCount === 1 ? "" : "s"} in browser storage. Migrate them to your Supabase account?`;
        migBanner.hidden = false;
      } else {
        migBanner.hidden = true;
      }
    }

    const isMissed = model && model.view === "missed";
    document.body.classList.toggle("missed-trades-view", isMissed);

    const missedBtn = byId("btn-missed-trades");
    if (missedBtn) missedBtn.classList.toggle("is-active", isMissed);

    const hidePanelsBtn = byId("btn-hide-panels");
    if (hidePanelsBtn) hidePanelsBtn.hidden = isMissed;

    const newTradeBtn = byId("btn-new-trade");
    if (newTradeBtn) {
      if (isMissed) {
        newTradeBtn.innerHTML = '<span aria-hidden="true">+</span> Log Missed Trade';
        newTradeBtn.title = "Log Missed Trade (Ctrl+N)";
      } else {
        newTradeBtn.innerHTML = '<span aria-hidden="true">+</span> New Trade';
        newTradeBtn.title = "New trade (Ctrl+N)";
      }
    }

    const missedSection = byId("missed-trades-section");
    const dashSection = byId("dashboard");
    const curveSection = byId("curve-panel");
    const tradeSection = byId("trade-section");
    const analyticsSection = byId("analytics");

    if (isMissed) {
      if (missedSection) missedSection.hidden = false;
      if (dashSection) dashSection.hidden = true;
      if (curveSection) curveSection.hidden = true;
      if (tradeSection) tradeSection.hidden = true;
      if (analyticsSection) analyticsSection.hidden = true;
      renderMissedTrades();
      renderFooter();
    } else {
      if (missedSection) missedSection.hidden = true;
      if (tradeSection) tradeSection.hidden = false;
      const panelsHidden = !!(model && model.settings && model.settings.hidePanels);
      if (dashSection) dashSection.hidden = panelsHidden;
      if (curveSection) curveSection.hidden = panelsHidden;
      if (analyticsSection) analyticsSection.hidden = panelsHidden;
      renderFilters();
      renderDashboard();
      renderCharts();
      renderTable();
      renderAnalytics();
      renderBackup();
      renderBlindBanner();
      renderFooter();
      if (detailsId) renderDetails();
    }
  }

  function groupTableHTML(groups, firstLabel) {
    const threshold = model.settings.lowSampleThreshold || 30;
    const rows = groups.map((group) => {
      const s = group.stats;
      return `<tr>
        <td class="group-name">${esc(group.key)}${s.total < threshold ? `<span class="low-sample" title="Fewer than ${threshold} trades. Treat this result cautiously.">low n</span>` : ""}</td>
        <td class="num">${s.total}</td>
        <td class="num">${fmtPct(s.winRate)}</td>
        <td class="num ${signedClass(s.avgR)}">${fmtSigned(s.avgR)}</td>
        <td class="num ${signedClass(s.totalR)}">${fmtSigned(s.totalR)}</td>
        <td class="num">${fmtPF(s.profitFactor)}</td>
        <td class="num">${s.avgMFE === null ? "—" : A.formatNumber(s.avgMFE, 2) + "R"}</td>
        <td class="num">${s.avgMAE === null ? "—" : A.formatNumber(s.avgMAE, 2) + "R"}</td>
        <td class="num ${signedClass(s.bestTrade)}">${fmtSigned(s.bestTrade)}</td>
        <td class="num ${signedClass(s.worstTrade)}">${fmtSigned(s.worstTrade)}</td>
      </tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>${esc(firstLabel)}</th><th class="num">Trades</th><th class="num">Win %</th><th class="num">Avg R</th><th class="num">Total R</th>
        <th class="num">PF</th><th class="num">Avg MFE</th><th class="num">Avg MAE</th><th class="num">Best</th><th class="num">Worst</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="10" class="muted">No completed trades in this batch.</td></tr>`}</tbody>
    </table></div>`;
  }

  function distributionTableHTML(rows, title) {
    return `<div class="analytics-block">
      <h3>${esc(title)}</h3>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Range</th><th class="num">Trades</th><th class="num">%</th><th class="num">Avg Final R</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <td>${esc(row.label)}</td>
          <td class="num">${row.count}</td>
          <td class="num">${fmtPct(row.pct)}</td>
          <td class="num ${signedClass(row.avgFinalR)}">${fmtSigned(row.avgFinalR)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`;
  }

  function mfeMaeGroupTable(group, title) {
    const threshold = model.settings.lowSampleThreshold || 30;
    const rows = group.map((g) => {
      const s = g.stats;
      return `<tr>
        <td class="group-name">${esc(g.key)}${s.total < threshold ? `<span class="low-sample" title="Fewer than ${threshold} trades.">low n</span>` : ""}</td>
        <td class="num">${s.total}</td>
        <td class="num">${s.avgMFE === null ? "—" : A.formatNumber(s.avgMFE, 2) + "R"}</td>
        <td class="num">${s.medianMFE === null ? "—" : A.formatNumber(s.medianMFE, 2) + "R"}</td>
        <td class="num">${s.avgMAE === null ? "—" : A.formatNumber(s.avgMAE, 2) + "R"}</td>
        <td class="num">${s.medianMAE === null ? "—" : A.formatNumber(s.medianMAE, 2) + "R"}</td>
      </tr>`;
    }).join("");
    return `<div class="analytics-block">
      <h3>${esc(title)}</h3>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Group</th><th class="num">Trades</th><th class="num">Avg MFE</th><th class="num">Med MFE</th><th class="num">Avg MAE</th><th class="num">Med MAE</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="muted">No data.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  }

  function targetMatrixHTML(trades, groupBy, thresholds, onlyCompletePath, title) {
    const groups = A.targetHitRatesByGroup(trades, groupBy, thresholds, { onlyCompletePath });
    const header = thresholds.map((t) => `<th class="num">${A.formatTargetR(t)}R</th>`).join("");
    const rows = groups.map((group) => {
      const total = group.rates.length && group.rates[0] ? group.rates[0].total : 0;
      const cells = group.rates.map((rate) => `<td class="num" title="${rate.hits} of ${rate.total} trades reached ${A.formatTargetR(rate.threshold)}R">${
        rate.rate === null ? "—" : fmtPct(rate.rate)
      }</td>`).join("");
      return `<tr><td class="group-name">${esc(group.key)}${lowSample(total)}</td><td class="num">${total}</td>${cells}</tr>`;
    }).join("");
    return `<div class="analytics-block">
      <h3>${esc(title)}</h3>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Group</th><th class="num">MFE n</th>${header}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${thresholds.length + 2}" class="muted">No trades with an MFE value.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  }

  function planOptionList() {
    const list = [];
    const seen = new Set();
    model.templates.forEach((tpl) => {
      const key = A.exitPlanKey(tpl.levels);
      if (!key) return;
      list.push({ id: "tpl:" + tpl.id, name: tpl.name, levels: tpl.levels, key });
      seen.add(key);
    });
    model.allTrades.forEach((trade) => {
      const key = A.exitPlanKey(trade.exitPlan);
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push({ id: "plan:" + key, name: trade.exitPlanTemplateName || A.planString(trade.exitPlan), levels: trade.exitPlan, key });
    });
    return list;
  }

  function comparisonTableHTML(rows) {
    const body = rows.map((row) => {
      const s = row.stats;
      const labelClass = row.label === "Recorded" ? "recorded" : "simulated";
      return `<tr>
        <td class="group-name">${esc(row.name)}${lowSample(s.total)}</td>
        <td><span class="comparison-label ${labelClass}">${row.label}</span></td>
        <td class="num">${s.total}</td>
        <td class="num">${fmtPct(s.winRate)}</td>
        <td class="num ${signedClass(s.avgR)}">${fmtSigned(s.avgR)}</td>
        <td class="num ${signedClass(s.totalR)}">${fmtSigned(s.totalR)}</td>
        <td class="num">${fmtPF(s.profitFactor)}</td>
        <td class="num neg">${s.maxDrawdown === null ? "—" : A.formatNumber(s.maxDrawdown, 2) + "R"}</td>
        <td class="num ${signedClass(s.expectancy)}">${fmtSigned(s.expectancy)}</td>
        <td class="num ${signedClass(s.bestTrade)}">${fmtSigned(s.bestTrade)}</td>
        <td class="num ${signedClass(s.worstTrade)}">${fmtSigned(s.worstTrade)}</td>
        <td class="num">${row.evaluated}${row.excluded ? ` <span class="faint">/ excl ${row.excluded}</span>` : ""}</td>
      </tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Exit Plan</th><th>Mode</th><th class="num">Trades</th><th class="num">Win %</th><th class="num">Avg R</th><th class="num">Total R</th>
        <th class="num">PF</th><th class="num">Max DD</th><th class="num">Expectancy</th><th class="num">Best</th><th class="num">Worst</th><th class="num">Eval / Excl</th>
      </tr></thead>
      <tbody>${body || `<tr><td colspan="12" class="muted">No evaluable results.</td></tr>`}</tbody>
    </table></div>`;
  }

  function emptyAnalytics(message) {
    return `<div class="empty-state" style="padding:32px 12px"><p>${esc(message)}</p></div>`;
  }

  function renderAnalytics() {
    const body = byId("analytics-body");
    const trades = model.filteredTrades;
    const completed = A.completedTrades(trades);
    const tab = model.analyticsTab || "session";
    document.querySelectorAll("#analytics-tabs .tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));

    if (!completed.length) {
      body.innerHTML = emptyAnalytics("No completed trades match the active filters.");
      return;
    }

    const opts = { orderBy: model.settings.orderBy, breakevenTolerance: model.settings.breakevenTolerance };
    const onlyComplete = !!model.settings.onlyCompletePath;

    if (tab === "session" || tab === "instrument" || tab === "direction" || tab === "setup" || tab === "quality") {
      const map = {
        session: { group: "session", label: "Session" },
        instrument: { group: "instrument", label: "Instrument" },
        direction: { group: "direction", label: "Direction" },
        setup: { group: "setup", label: "Setup" },
        quality: { group: "setupQuality", label: "Setup Quality" },
      }[tab];
      const groups = A.groupStats(trades, map.group, opts);
      body.innerHTML = `<div class="analytics-toolbar"><span>Grouped by ${esc(map.label.toLowerCase())} · completed trades only · sample sizes shown</span></div>` +
        groupTableHTML(groups, map.label);
      return;
    }

    if (tab === "mfe") {
      const mfeRows = A.mfeDistribution(trades, model.settings.mfeBoundaries);
      const maeRows = A.maeDistribution(trades, model.settings.maeBoundaries);
      const groupFields = {
        "Setup": "setup",
        "Instrument": "instrument",
        "Session": "session",
        "Direction": "direction",
      };
      let blocks = "";
      Object.keys(groupFields).forEach((label) => {
        blocks += mfeMaeGroupTable(A.groupStats(trades, groupFields[label], opts), label);
      });
      blocks += mfeMaeGroupTable(A.groupStats(trades, (t) => A.planString(t.exitPlan), opts), "Exit Plan");
      body.innerHTML = `<div class="analytics-toolbar">
          <span>MFE and MAE are measured in multiples of each trade's own stop distance.</span>
          <label class="switch"><input type="checkbox" data-setting-toggle="onlyCompletePath"${onlyComplete ? " checked" : ""}> Only complete paths for target hits</label>
        </div>
        <div class="analytics-grid">
          ${distributionTableHTML(mfeRows, "MFE Distribution")}
          ${distributionTableHTML(maeRows, "MAE Distribution")}
        </div>
        <div class="analytics-grid" style="margin-top:12px">${blocks}</div>`;
      return;
    }

    if (tab === "targets") {
      const thresholds = model.settings.thresholds;
      const rates = A.targetHitRates(trades, thresholds, { onlyCompletePath: onlyComplete });
      const rows = rates.map((rate) => `<tr>
        <td class="group-name">${A.formatTargetR(rate.threshold)}R</td>
        <td class="num">${rate.rate === null ? "—" : fmtPct(rate.rate)}</td>
        <td class="num">${rate.hits} / ${rate.total}</td>
        <td class="num">${onlyComplete ? rate.excludedByPath : 0}</td>
        <td style="width:38%"><span class="hit-bar"><span class="hit-track"><span class="hit-fill" style="width:${Math.max(0, Math.min(100, rate.rate || 0))}%"></span></span></span></td>
      </tr>`).join("");
      body.innerHTML = `<div class="analytics-toolbar">
          <span>Thresholds: ${thresholds.map((t) => A.formatTargetR(t) + "R").join(" · ")}</span>
          <div class="controls">
            <label class="switch"><input type="checkbox" data-setting-toggle="onlyCompletePath"${onlyComplete ? " checked" : ""}> Only trades with a complete path</label>
            <button type="button" class="btn btn-ghost btn-small" data-open-settings="1">Edit thresholds</button>
          </div>
        </div>
        <div class="table-wrap" style="margin-bottom:12px"><table class="data-table">
          <thead><tr><th>Threshold</th><th class="num">Hit rate</th><th class="num">Hit / MFE n</th><th class="num">Excluded by path</th><th>Distribution</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="analytics-grid">
          ${targetMatrixHTML(trades, "setup", thresholds, onlyComplete, "Target Hits by Setup")}
          ${targetMatrixHTML(trades, "instrument", thresholds, onlyComplete, "Target Hits by Instrument")}
          ${targetMatrixHTML(trades, "session", thresholds, onlyComplete, "Target Hits by Session")}
          ${targetMatrixHTML(trades, "direction", thresholds, onlyComplete, "Target Hits by Direction")}
        </div>`;
      return;
    }

    if (tab === "comparison") {
      const modeButtons = `<div class="segmented" role="group" aria-label="Comparison mode">
          <button type="button" class="seg${comparisonMode === "recorded" ? " active" : ""}" data-comparison-mode="recorded">As recorded</button>
          <button type="button" class="seg${comparisonMode === "simulated" ? " active" : ""}" data-comparison-mode="simulated">Re-evaluate</button>
        </div>`;
      if (comparisonMode === "recorded") {
        const groups = A.recordedPlanComparison(trades, opts);
        body.innerHTML = `<div class="analytics-toolbar">
            <span>Grouped by the Exit Plan actually stored on each completed trade. Numbers are <strong>Recorded</strong>.</span>
            ${modeButtons}
          </div>${comparisonTableHTML(groups)}`;
        return;
      }

      const options = planOptionList();
      const valid = new Set(options.map((o) => o.id));
      selectedPlanIds = new Set(Array.from(selectedPlanIds).filter((id) => valid.has(id)));
      if (!selectedPlanIds.size) options.slice(0, 3).forEach((o) => selectedPlanIds.add(o.id));
      const selected = options.filter((o) => selectedPlanIds.has(o.id));
      const results = selected.length
        ? A.simulatedPlanComparison(trades, selected, {
            onlyCommon: !!model.settings.onlyCommonPlans,
            orderBy: model.settings.orderBy,
            breakevenTolerance: model.settings.breakevenTolerance,
          })
        : [];
      body.innerHTML = `<div class="analytics-toolbar">
          <span>Apply saved Exit Plans to the stored Trade Paths. Numbers are <strong>Simulated</strong>. Incomplete paths are excluded and counted.</span>
          ${modeButtons}
        </div>
        <div class="analytics-toolbar">
          <div class="plan-choices">${options.map((option) => `<label class="plan-choice">
            <input type="checkbox" data-plan-check="${esc(option.id)}"${selectedPlanIds.has(option.id) ? " checked" : ""}>
            <span><span class="plan-choice-name">${esc(option.name)}</span><br><span class="plan-choice-levels">${esc(A.planString(option.levels))}</span></span>
          </label>`).join("") || '<span class="muted">No saved Exit Plans. Create one in Exit Plans.</span>'}</div>
        </div>
        <div class="analytics-toolbar">
          <label class="switch"><input type="checkbox" data-setting-toggle="onlyCommonPlans"${model.settings.onlyCommonPlans ? " checked" : ""}> Compare only trades evaluable under all selected plans</label>
          <span class="muted">${selected.length} plan${selected.length === 1 ? "" : "s"} selected</span>
        </div>
        ${comparisonTableHTML(results)}`;
      return;
    }

    if (tab === "runner-vs-partials") {
      const rvp = A.compareFullTargetVsPartials(trades, opts);
      const badge = rvp.recommendation === "runners"
        ? '<span class="pill pill-win">Full Runners Outperforming</span>'
        : rvp.recommendation === "partials"
          ? '<span class="pill pill-accent">Partials Outperforming</span>'
          : '<span class="pill pill-be">Equal Edge</span>';

      const varianceSign = rvp.varianceR > 0 ? "+" : "";

      body.innerHTML = `
        <div class="dash-runner-card" style="margin-bottom:16px">
          <div class="dash-runner-head">
            <div class="dash-runner-title">
              <span class="dash-runner-icon">⚡</span>
              <div>
                <h4>Full Target vs. Actual Partials</h4>
                <span class="muted">Theoretical runner performance if all winning trades ran 100% to final target</span>
              </div>
            </div>
            <div class="dash-runner-head-right">
              ${badge}
            </div>
          </div>
          <div class="dash-runner-metrics">
            <div class="dash-card">
              <div class="dash-card-label">Total Realized R (With Partials)</div>
              <div class="dash-card-value ${signedClass(rvp.totalRealizedR)}">${fmtSigned(rvp.totalRealizedR)}</div>
              <div class="dash-card-sub">Net ${fmtSigned(rvp.allNetRealizedR)} across ${rvp.totalCompleted} trade${rvp.totalCompleted === 1 ? '' : 's'} (${rvp.winCount} win${rvp.winCount === 1 ? '' : 's'})</div>
            </div>
            <div class="dash-card">
              <div class="dash-card-label">Total Potential R (Without Partials / Full Target)</div>
              <div class="dash-card-value ${signedClass(rvp.totalPotentialR)}">${fmtSigned(rvp.totalPotentialR)}</div>
              <div class="dash-card-sub">Net ${fmtSigned(rvp.allNetPotentialR)} without partials (avg +${A.formatNumber(rvp.avgPotentialR, 2)}R)</div>
            </div>
            <div class="dash-card">
              <div class="dash-card-label">Variance / Opportunity Cost</div>
              <div class="dash-card-value ${signedClass(rvp.varianceR)}">${varianceSign}${A.formatNumber(rvp.varianceR, 2)}R</div>
              <div class="dash-card-sub">${rvp.varianceR >= 0 ? "Potential gain by holding runners" : "Gain preserved by taking partials"}</div>
            </div>
          </div>
          <div class="dash-runner-insight">
            <p>${esc(rvp.summaryText)}</p>
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Trade</th>
                <th>Exit Plan</th>
                <th class="num">Full Target (Rem. Exit R)</th>
                <th class="num">Realized R (Partials)</th>
                <th class="num">Potential R (Full Target)</th>
                <th class="num">Variance (Δ R)</th>
                <th>Strategy Edge</th>
              </tr>
            </thead>
            <tbody>
              ${rvp.rows.map(r => `<tr>
                <td class="mono">#${esc(r.trade.tradeNumber || r.trade.id)} ${esc(r.trade.instrument || '')} <span class="muted">${esc(r.trade.direction || '')}</span></td>
                <td><span class="plan-cell">${esc(r.planLabel)}</span></td>
                <td class="num">${A.formatTargetR(r.maxTargetR)}R</td>
                <td class="num ${signedClass(r.realizedR)}"><b>${fmtSigned(r.realizedR)}</b></td>
                <td class="num ${signedClass(r.potentialR)}"><b>${fmtSigned(r.potentialR)}</b></td>
                <td class="num ${signedClass(r.varianceR)}">${r.varianceR > 0 ? '+' : ''}${A.formatNumber(r.varianceR, 2)}R</td>
                <td>${r.varianceR > 0
                  ? '<span class="pill pill-win">Runner +</span>'
                  : r.varianceR < 0
                    ? '<span class="pill pill-accent">Partials +</span>'
                    : '<span class="pill pill-be">Equal</span>'}</td>
              </tr>`).join('') || '<tr><td colspan="7" class="center muted">No winning trades match the active filters.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
      return;
    }

    if (tab === "sl-optimization") {
      const opt = A.compareSlOptimization(trades, opts);
      const wick = opt.wick;
      const bodyStats = opt.body;
      const spcStats = opt.spc || { totalR: 0, expectancy: 0, winRate: null, stopOutFreq: null, wins: 0, losses: 0, breakevens: 0, stopOuts: 0, avgWinR: 0 };
      const diff = opt.diff;

      const winnerBadge = diff.winner === "spc"
        ? '<span class="pill pill-win" style="background:rgba(139,92,246,0.18);color:#a78bfa;border-color:rgba(139,92,246,0.35)">SPC SL Advantage</span>'
        : diff.winner === "body"
          ? '<span class="pill pill-win">Body SL Advantage</span>'
          : diff.winner === "wick"
            ? '<span class="pill pill-win">Wick SL Advantage</span>'
            : '<span class="pill pill-be">Equal Edge</span>';

      const winnerTitle = diff.winner === "spc"
        ? "SPC SL (Space SL)"
        : diff.winner === "body"
          ? "Body SL"
          : diff.winner === "wick"
            ? "Wick SL"
            : (diff.winnerLabel || "Equal Edge");

      body.innerHTML = `
        <div class="analytics-toolbar">
          <span>Stop-Loss Optimization (3-Way: Wick vs. Body vs. SPC) · Evaluated across ${opt.total} completed trade${opt.total === 1 ? '' : 's'}.</span>
          <div>${winnerBadge}</div>
        </div>

        <div class="sl-opt-summary-banner ${diff.winner === 'spc' ? 'winner-spc' : diff.winner === 'body' ? 'winner-body' : diff.winner === 'wick' ? 'winner-wick' : ''}">
          <div class="sl-opt-summary-title">
            <span>Optimal Strategy:</span>
            <b class="mono ${diff.winner !== 'tie' ? 'pos' : 'zero'}">${winnerTitle}</b>
          </div>
          <p class="sl-opt-summary-desc">${esc(diff.summaryText)}</p>
        </div>

        <div class="sl-opt-grid">
          <!-- Wick SL Model Card -->
          <div class="sl-model-panel">
            <div class="sl-model-head">
              <h4>Wick SL Model</h4>
              <span class="pill pill-accent">Safe Placement</span>
            </div>
            <p class="sl-model-subtitle">Stop loss placed at candle extreme wick (safer stop, lower stop-out frequency).</p>
            <div class="sl-metrics-grid">
              <div class="dash-card">
                <div class="dash-card-label">Average Win Rate</div>
                <div class="dash-card-value">${wick.winRate === null ? "—" : fmtPct(wick.winRate)}</div>
                <div class="dash-card-sub">${wick.wins}W / ${wick.losses}L / ${wick.breakevens}BE</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Total Net R</div>
                <div class="dash-card-value ${signedClass(wick.totalR)}">${fmtSigned(wick.totalR)}</div>
                <div class="dash-card-sub">Cumulative Net R</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Expectancy (Avg R)</div>
                <div class="dash-card-value ${signedClass(wick.expectancy)}">${fmtSigned(wick.expectancy)}</div>
                <div class="dash-card-sub">Net expected R per trade</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Average Win R</div>
                <div class="dash-card-value pos">+${A.formatNumber(wick.avgWinR, 2)}R</div>
                <div class="dash-card-sub">Avg return per winning trade</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Stop-Out Frequency</div>
                <div class="dash-card-value ${wick.stopOutFreq > 40 ? 'neg' : ''}">${wick.stopOutFreq === null ? "—" : fmtPct(wick.stopOutFreq)}</div>
                <div class="dash-card-sub">${wick.stopOuts} of ${opt.total} trades stopped out</div>
              </div>
            </div>
          </div>

          <!-- Body SL Model Card -->
          <div class="sl-model-panel">
            <div class="sl-model-head">
              <h4>Body SL Model</h4>
              <span class="pill pill-accent">Tight Placement</span>
            </div>
            <p class="sl-model-subtitle">Stop loss placed at candle body (amplified R:R ratio, tighter risk distance).</p>
            <div class="sl-metrics-grid">
              <div class="dash-card">
                <div class="dash-card-label">Average Win Rate</div>
                <div class="dash-card-value">${bodyStats.winRate === null ? "—" : fmtPct(bodyStats.winRate)}</div>
                <div class="dash-card-sub">${bodyStats.wins}W / ${bodyStats.losses}L / ${bodyStats.breakevens}BE</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Total Net R</div>
                <div class="dash-card-value ${signedClass(bodyStats.totalR)}">${fmtSigned(bodyStats.totalR)}</div>
                <div class="dash-card-sub">Cumulative Net R</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Expectancy (Avg R)</div>
                <div class="dash-card-value ${signedClass(bodyStats.expectancy)}">${fmtSigned(bodyStats.expectancy)}</div>
                <div class="dash-card-sub">Net expected R per trade</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Average Win R</div>
                <div class="dash-card-value pos">+${A.formatNumber(bodyStats.avgWinR, 2)}R</div>
                <div class="dash-card-sub">Avg return per winning trade</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Stop-Out Frequency</div>
                <div class="dash-card-value ${bodyStats.stopOutFreq > 40 ? 'neg' : ''}">${bodyStats.stopOutFreq === null ? "—" : fmtPct(bodyStats.stopOutFreq)}</div>
                <div class="dash-card-sub">${bodyStats.stopOuts} of ${opt.total} trades stopped out</div>
              </div>
            </div>
          </div>

          <!-- SPC SL Model Card -->
          <div class="sl-model-panel">
            <div class="sl-model-head">
              <h4>SPC SL (Space SL)</h4>
              <span class="pill" style="background:rgba(139,92,246,0.18);color:#a78bfa;border-color:rgba(139,92,246,0.35)">Breathing Room</span>
            </div>
            <p class="sl-model-subtitle">Stop loss placed with extra breathing space beyond the wick to absorb sweeps.</p>
            <div class="sl-metrics-grid">
              <div class="dash-card">
                <div class="dash-card-label">Average Win Rate</div>
                <div class="dash-card-value">${spcStats.winRate === null ? "—" : fmtPct(spcStats.winRate)}</div>
                <div class="dash-card-sub">${spcStats.wins}W / ${spcStats.losses}L / ${spcStats.breakevens}BE</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Total Net R</div>
                <div class="dash-card-value ${signedClass(spcStats.totalR)}">${fmtSigned(spcStats.totalR)}</div>
                <div class="dash-card-sub">Cumulative Net R</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Expectancy (Avg R)</div>
                <div class="dash-card-value ${signedClass(spcStats.expectancy)}">${fmtSigned(spcStats.expectancy)}</div>
                <div class="dash-card-sub">Net expected R per trade</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Average Win R</div>
                <div class="dash-card-value pos">+${A.formatNumber(spcStats.avgWinR, 2)}R</div>
                <div class="dash-card-sub">Avg return per winning trade</div>
              </div>
              <div class="dash-card">
                <div class="dash-card-label">Stop-Out Frequency</div>
                <div class="dash-card-value ${spcStats.stopOutFreq > 40 ? 'neg' : ''}">${spcStats.stopOutFreq === null ? "—" : fmtPct(spcStats.stopOutFreq)}</div>
                <div class="dash-card-sub">${spcStats.stopOuts} of ${opt.total} trades stopped out</div>
              </div>
            </div>
          </div>
        </div>

        <div class="table-wrap" style="margin-top:16px">
          <table class="data-table">
            <thead>
              <tr>
                <th>Trade</th>
                <th class="num">Wick SL (R:R)</th>
                <th class="num">Body SL (R:R)</th>
                <th class="num">SPC SL (R:R)</th>
                <th class="num">Wick Outcome</th>
                <th class="num">Body Outcome</th>
                <th class="num">SPC Outcome</th>
                <th class="num">Best Strategy</th>
              </tr>
            </thead>
            <tbody>
              ${opt.trades.slice(0, 50).map(r => {
                let bestBadge = '<span class="pill pill-be">Tie</span>';
                if (r.spcR > r.wickR && r.spcR > r.bodyR) {
                  bestBadge = '<span class="pill" style="background:rgba(139,92,246,0.18);color:#a78bfa;border-color:rgba(139,92,246,0.35)">SPC SL</span>';
                } else if (r.bodyR > r.wickR && r.bodyR > r.spcR) {
                  bestBadge = '<span class="pill pill-win">Body SL</span>';
                } else if (r.wickR > r.bodyR && r.wickR > r.spcR) {
                  bestBadge = '<span class="pill pill-accent">Wick SL</span>';
                }
                return `<tr>
                  <td class="mono">#${esc(r.trade.tradeNumber || r.trade.id)} ${esc(r.trade.instrument || '')}</td>
                  <td class="num">${esc(String(r.wickRr || "—"))}</td>
                  <td class="num">${esc(String(r.bodyRr || "—"))}</td>
                  <td class="num">${esc(String(r.spcSl || "—"))}</td>
                  <td class="num ${signedClass(r.wickR)}">${fmtSigned(r.wickR)}${r.wickStopped ? ' <span class="pill pill-loss">SL</span>' : ''}</td>
                  <td class="num ${signedClass(r.bodyR)}">${fmtSigned(r.bodyR)}${r.bodyStopped ? ' <span class="pill pill-loss">SL</span>' : ''}</td>
                  <td class="num ${signedClass(r.spcR)}">${fmtSigned(r.spcR)}${r.spcStopped ? ' <span class="pill pill-loss">SL</span>' : ''}</td>
                  <td class="num">${bestBadge}</td>
                </tr>`;
              }).join('') || '<tr><td colspan="8" class="center muted">No trades to display.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
      return;
    }
  }

  function openModal(options) {
    const overlay = h("div", { class: "modal-overlay" });
    const modal = h("div", { class: "modal " + (options.size || ""), role: "dialog", "aria-modal": "true" });
    const head = h("div", { class: "modal-head" });
    const titleWrap = h("div");
    titleWrap.appendChild(h("h2", { text: options.title || "" }));
    if (options.subtitle) titleWrap.appendChild(h("p", { text: options.subtitle }));
    head.appendChild(titleWrap);
    const closeBtn = h("button", { class: "modal-close", type: "button", "aria-label": "Close", text: "×" });
    head.appendChild(closeBtn);
    const body = h("div", { class: "modal-body" });
    const foot = h("div", { class: "modal-foot" });
    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    overlay.appendChild(modal);
    byId("modal-root").appendChild(overlay);

    let closed = false;
    const entry = {
      overlay,
      modal,
      body,
      foot,
      close: function (reason) {
        if (closed) return;
        closed = true;
        overlay.remove();
        modalStack = modalStack.filter((m) => m !== entry);
        if (options.onClose) options.onClose(reason || "close");
      },
    };
    modalStack.push(entry);
    closeBtn.addEventListener("click", () => entry.close("cancel"));
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay && options.dismissible !== false) entry.close("cancel");
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusables = Array.from(modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    if (options.footer) {
      if (typeof options.footer === "string") foot.innerHTML = options.footer;
      else foot.appendChild(options.footer);
    } else {
      foot.hidden = true;
    }
    if (options.body) {
      if (typeof options.body === "string") body.innerHTML = options.body;
      else body.appendChild(options.body);
    }
    setTimeout(() => {
      const target = options.focus ? modal.querySelector(options.focus) : modal.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button");
      if (target) target.focus();
    }, 20);
    return entry;
  }

  function closeTopModal() {
    if (!modalStack.length) return false;
    modalStack[modalStack.length - 1].close("escape");
    return true;
  }

  function confirm(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
        entry.close("confirm");
      };
      const body = h("div");
      body.appendChild(h("p", { class: "confirm-text", text: opts.message || "" }));
      if (opts.details && opts.details.length) {
        const ul = h("ul", { class: "confirm-list" });
        opts.details.slice(0, 20).forEach((d) => ul.appendChild(h("li", { text: d })));
        body.appendChild(ul);
      }
      const footer = h("div", { class: "modal-foot" });
      footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: opts.cancelLabel || "Cancel", onclick: () => finish(false) }));
      footer.appendChild(h("button", {
        type: "button",
        class: "btn " + (opts.danger ? "btn-danger" : "btn-primary"),
        text: opts.confirmLabel || "Confirm",
        onclick: () => finish(true),
      }));
      const entry = openModal({
        title: opts.title || "Confirm",
        size: "modal-sm",
        body,
        footer,
        focus: ".modal-foot .btn:last-child",
        onClose: () => finish(false),
      });
      setTimeout(() => {
        const primary = entry.foot.querySelector(".btn:last-child");
        if (primary) primary.focus();
      }, 30);
    });
  }

  function prompt(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
        entry.close("prompt");
      };
      const input = h("input", { type: "text", value: opts.value || "", placeholder: opts.placeholder || "" });
      const wrap = h("div", { class: "field" }, h("label", { text: opts.label || "Value" }), input);
      const footer = h("div", { class: "modal-foot" });
      footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => finish(null) }));
      footer.appendChild(h("button", { type: "button", class: "btn btn-primary", text: opts.confirmLabel || "Save", onclick: () => finish(input.value.trim() || null) }));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(input.value.trim() || null);
        }
      });
      const entry = openModal({
        title: opts.title || "Enter a value",
        size: "modal-sm",
        body: wrap,
        footer,
        onClose: () => finish(null),
      });
      setTimeout(() => {
        input.focus();
        input.select();
      }, 30);
    });
  }

  function toast(message, options) {
    const opts = options || {};
    const node = h("div", { class: "toast " + (opts.type || "") });
    node.appendChild(h("span", { text: message }));
    if (opts.actionLabel) {
      node.appendChild(h("button", { type: "button", text: opts.actionLabel, onclick: () => {
        if (opts.onAction) opts.onAction();
        node.remove();
      } }));
    }
    node.appendChild(h("button", { type: "button", class: "toast-close", text: "×", "aria-label": "Dismiss", onclick: () => node.remove() }));
    byId("toast-root").appendChild(node);
    if (opts.duration !== 0) {
      setTimeout(() => node.remove(), opts.duration || 4200);
    }
    return node;
  }

  function planPreviewText(levels, trade) {
    const check = A.validateExitPlan(levels);
    if (!check.valid) return "Total allocation must equal 100%.";
    const synthetic = Object.assign({}, trade || {}, { exitPlan: levels.map((l) => ({ ...l })) });
    const mfe = synthetic.tradePath ? A.toNum(synthetic.tradePath.mfe) : null;
    if (mfe === null && A.toNum(synthetic.finalROverride) === null) return "Final R needs MFE or a manual override.";
    return "Final R: " + A.formatR(A.finalR(synthetic));
  }

  function createPlanEditor(options) {
    const opts = options || {};
    let levels = (opts.levels && opts.levels.length ? opts.levels : A.defaultExitPlan()).map((l) => ({ allocation: A.toNum(l.allocation) || 0, targetR: A.toNum(l.targetR) || 0 }));
    let templateId = opts.templateId || null;
    const root = h("div", { class: "plan-editor" });
    const rowsEl = h("div");
    const totalEl = h("span", { class: "plan-total" });
    const previewEl = h("span", { class: "plan-preview" });
    const templateSelect = h("select", { class: "", "aria-label": "Exit Plan template" });
    const saveTplBtn = h("button", { type: "button", class: "btn btn-ghost btn-small", text: "Save as template" });

    root.appendChild(h("div", { class: "plan-editor-head" }, h("span", { text: "Alloc %" }), h("span", { text: "Target R" }), h("span", { text: "Target price" }), h("span", { text: "" })));
    root.appendChild(rowsEl);
    const foot = h("div", { class: "plan-editor-foot" });
    const footLeft = h("div", { class: "inline-actions" }, totalEl, previewEl);
    const footRight = h("div", { class: "inline-actions" });
    const addBtn = h("button", { type: "button", class: "btn btn-ghost btn-small", text: "+ Add level" });
    footRight.appendChild(addBtn);
    foot.appendChild(footLeft);
    foot.appendChild(footRight);
    root.appendChild(foot);

    if (opts.showTemplateSelect !== false) {
      const tplRow = h("div", { class: "plan-quick" });
      templateSelect.style.minWidth = "150px";
      templateSelect.style.maxWidth = "100%";
      templateSelect.addEventListener("change", () => {
        if (!templateSelect.value) return;
        const tpl = (opts.templates || []).find((t) => t.id === templateSelect.value);
        if (!tpl) return;
        levels = A.normalizeLevels(tpl.levels).map((l) => ({ ...l }));
        templateId = tpl.id;
        renderRows();
        sync();
      });
      tplRow.appendChild(templateSelect);
      if (opts.onSaveTemplate) {
        tplRow.appendChild(saveTplBtn);
        saveTplBtn.addEventListener("click", async () => {
          const name = await prompt({ title: "Save Exit Plan template", label: "Template name", value: "My Plan", confirmLabel: "Save template" });
          if (!name) return;
          const check = A.validateExitPlan(levels);
          if (!check.valid) {
            toast(check.errors[0].message, { type: "error" });
            return;
          }
          opts.onSaveTemplate(name, levels.map((l) => ({ ...l })));
        });
      }
      root.appendChild(tplRow);
    }

    function currentTrade() {
      return opts.getTrade ? opts.getTrade() : opts.trade || {};
    }

    function sync() {
      const check = A.validateExitPlan(levels);
      const totalPct = A.clampNumber(A.totalAllocation(levels) * 100, 2);
      totalEl.textContent = "Total: " + totalPct + "%";
      totalEl.classList.toggle("good", check.valid);
      totalEl.classList.toggle("bad", !check.valid);
      const trade = currentTrade();
      previewEl.innerHTML = planPreviewText(levels, trade);
      rowsEl.querySelectorAll("[data-plan-row]").forEach((row) => {
        const idx = parseInt(row.dataset.planRow, 10);
        const lvl = levels[idx];
        if (!lvl) return;
        const priceEl = row.querySelector("[data-plan-price]");
        if (priceEl) {
          const price = A.targetPriceForTrade(trade, lvl.targetR);
          priceEl.textContent = price === null ? "—" : fmtPrice(price, trade);
        }
      });
      if (templateSelect) {
        templateSelect.value = templateId && (opts.templates || []).some((t) => t.id === templateId) ? templateId : "";
      }
      if (opts.onChange) opts.onChange(levels.map((l) => ({ ...l })), templateId);
    }

    function renderRows() {
      rowsEl.innerHTML = "";
      levels.forEach((lvl, idx) => {
        const allocInput = h("input", { type: "number", step: "0.1", min: "0", max: "100", value: A.formatAllocation(lvl.allocation), "aria-label": "Allocation percent" });
        const targetInput = h("input", { type: "number", step: "0.1", min: "0", value: A.formatTargetR(lvl.targetR), "aria-label": "Target R" });
        const priceEl = h("span", { class: "plan-target", "data-plan-price": "1", text: "—" });
        const actions = h("div", { class: "plan-row-actions" });
        const up = h("button", { type: "button", class: "icon-btn", title: "Move up", text: "↑" });
        const down = h("button", { type: "button", class: "icon-btn", title: "Move down", text: "↓" });
        const remove = h("button", { type: "button", class: "icon-btn danger", title: "Remove level", text: "×" });
        up.disabled = idx === 0;
        down.disabled = idx === levels.length - 1;
        up.addEventListener("click", () => {
          if (idx === 0) return;
          const tmp = levels[idx - 1];
          levels[idx - 1] = levels[idx];
          levels[idx] = tmp;
          templateId = null;
          renderRows();
          sync();
        });
        down.addEventListener("click", () => {
          if (idx === levels.length - 1) return;
          const tmp = levels[idx + 1];
          levels[idx + 1] = levels[idx];
          levels[idx] = tmp;
          templateId = null;
          renderRows();
          sync();
        });
        remove.addEventListener("click", () => {
          if (levels.length <= 1) {
            toast("An Exit Plan needs at least one level.", { type: "error" });
            return;
          }
          levels.splice(idx, 1);
          templateId = null;
          renderRows();
          sync();
        });
        allocInput.addEventListener("input", () => {
          levels[idx].allocation = (A.toNum(allocInput.value) || 0) / 100;
          templateId = null;
          sync();
        });
        targetInput.addEventListener("input", () => {
          levels[idx].targetR = A.toNum(targetInput.value) || 0;
          templateId = null;
          sync();
        });
        actions.appendChild(up);
        actions.appendChild(down);
        actions.appendChild(remove);
        const row = h("div", { class: "plan-row", dataset: { planRow: String(idx) } }, allocInput, targetInput, priceEl, actions);
        rowsEl.appendChild(row);
      });
    }

    addBtn.addEventListener("click", () => {
      const lastTarget = levels.length ? levels[levels.length - 1].targetR + 1 : 1;
      levels.push({ allocation: 0, targetR: lastTarget });
      templateId = null;
      renderRows();
      sync();
    });

    function setTemplates(templates) {
      opts.templates = templates || [];
      if (templateSelect) templateSelect.innerHTML = optionsHTML(opts.templates.map((t) => ({ value: t.id, label: t.name })), templateId, "Template…");
    }

    setTemplates(opts.templates || []);
    renderRows();
    sync();

    return {
      element: root,
      getLevels: () => levels.map((l) => ({ ...l })),
      setLevels: (newLevels, newTemplateId) => {
        levels = A.normalizeLevels(newLevels).map((l) => ({ ...l }));
        if (newTemplateId !== undefined) templateId = newTemplateId;
        renderRows();
        sync();
      },
      getTemplateId: () => templateId,
      refresh: sync,
      element: root,
    };
  }

  function createResultFields(options) {
    const opts = options || {};
    const draft = opts.draft;
    const root = h("div");
    const quick = h("div", { class: "quick-r" });
    quick.appendChild(h("span", { class: "muted", style: { alignSelf: "center", fontSize: "10.5px" }, text: "Quick:" }));
    [-1, -0.5, 0, 1, 2, 3, 4, 6, 9].forEach((value) => {
      const btn = h("button", { type: "button", class: "btn btn-ghost btn-small", text: A.formatR(value) });
      btn.addEventListener("click", () => {
        finalInput.value = String(value);
        finalInput.dispatchEvent(new Event("input", { bubbles: true }));
        finalInput.focus();
      });
      quick.appendChild(btn);
    });

    root.innerHTML = `<div class="form-grid">
      <div class="field" data-wrap="mfe"><label>MFE (R)</label><input name="mfe" type="number" step="0.01" min="0" placeholder="e.g. 7.2"><span class="hint">Unmanaged max favorable move before the original SL.</span><div class="field-errors" data-errors="mfe"></div></div>
      <div class="field" data-wrap="mae"><label>MAE (R)</label><input name="mae" type="number" step="0.01" min="0" placeholder="e.g. 0.4"><span class="hint">Max adverse move before the trade resolved.</span><div class="field-errors" data-errors="mae"></div></div>
      <div class="field" data-wrap="pathComplete"><label>Path complete</label><label class="switch" style="padding-top:5px"><input type="checkbox" name="pathComplete"> Replay reached original SL</label><span class="hint">Required for exact Exit Plan re-evaluation.</span></div>
      <div class="field" data-wrap="exitReason"><label>Exit reason</label><select name="exitReason">${optionsHTML(A.DEFAULTS.exitReasons, draft.exitReason || "", "—")}</select><div class="field-errors" data-errors="exitReason"></div></div>
      <div class="field" data-wrap="remainderExitR"><label>Remainder Exit R</label><input name="remainderExitR" type="number" step="0.01" placeholder="-1, 0, +0.6"><span class="hint">SL sets −1R · BE sets 0R.</span><div class="field-errors" data-errors="remainderExitR"></div></div>
      <div class="field span-2" data-wrap="finalROverride"><label>Final R override</label><input name="finalROverride" type="number" step="0.01" placeholder="Leave empty to calculate"><span class="hint">Manual override is marked OVR in the table.</span><div class="field-errors" data-errors="finalR"></div></div>
      <div class="field span-2"><label>Quick values</label><div data-quick></div></div>
    </div>
    <div class="section-title" style="margin-top:14px">Levels hit <span class="hint" style="text-transform:none;letter-spacing:normal;font-weight:400">Override only when real management differs from MFE</span></div>
    <div class="level-toggle" data-toggles></div>
    <div class="plan-preview" style="margin-top:8px" data-result-preview></div>`;

    const mfeInput = root.querySelector('[name="mfe"]');
    const maeInput = root.querySelector('[name="mae"]');
    const pathInput = root.querySelector('[name="pathComplete"]');
    const reasonInput = root.querySelector('[name="exitReason"]');
    const remainderInput = root.querySelector('[name="remainderExitR"]');
    const finalInput = root.querySelector('[name="finalROverride"]');
    const togglesEl = root.querySelector("[data-toggles]");
    const previewEl = root.querySelector("[data-result-preview]");
    const quickHolder = root.querySelector("[data-quick]");
    quickHolder.appendChild(quick);

    mfeInput.value = draft.tradePath && draft.tradePath.mfe !== null && draft.tradePath.mfe !== undefined ? draft.tradePath.mfe : "";
    maeInput.value = draft.tradePath && draft.tradePath.mae !== null && draft.tradePath.mae !== undefined ? draft.tradePath.mae : "";
    pathInput.checked = !!(draft.tradePath && draft.tradePath.pathComplete);
    reasonInput.value = draft.exitReason || "";
    remainderInput.value = draft.remainderExitR !== null && draft.remainderExitR !== undefined ? draft.remainderExitR : "";
    finalInput.value = draft.finalROverride !== null && draft.finalROverride !== undefined ? draft.finalROverride : "";

    let override = Array.isArray(draft.levelsHitOverride) ? draft.levelsHitOverride.slice() : null;

    function currentTrade() {
      const levels = opts.getLevels ? opts.getLevels() : draft.exitPlan;
      return Object.assign({}, draft, {
        exitPlan: levels,
        tradePath: {
          mfe: A.toNum(mfeInput.value),
          mae: A.toNum(maeInput.value),
          pathComplete: pathInput.checked,
          waypoints: draft.tradePath ? draft.tradePath.waypoints : null,
        },
        remainderExitR: A.toNum(remainderInput.value),
        finalROverride: A.toNum(finalInput.value),
        levelsHitOverride: override,
        exitReason: reasonInput.value || null,
        riskR: A.toNum(draft.riskR) || 1,
      });
    }

    function refreshPreview() {
      const trade = currentTrade();
      const result = A.finalR(trade);
      previewEl.innerHTML = result === null ? "Final R: incomplete (needs MFE and an exit result)" : `Final R: <b class="${signedClass(result)}">${A.formatR(result)}</b>`;
    }

    function renderToggles() {
      const levels = opts.getLevels ? opts.getLevels() : draft.exitPlan;
      const mfe = A.toNum(mfeInput.value);
      const derived = levels.map((lvl) => mfe !== null && mfe >= lvl.targetR);
      if (override && override.length !== levels.length) override = null;
      const state = override || derived;
      togglesEl.innerHTML = levels.map((lvl, idx) => `<label class="level-toggle-row">
          <input type="checkbox" data-level-toggle="${idx}"${state[idx] ? " checked" : ""}>
          <span class="lvl-text">${A.formatAllocation(lvl.allocation)}% @ ${A.formatTargetR(lvl.targetR)}R</span>
          <span class="lvl-r">${state[idx] ? "hit" : "miss"}</span>
        </label>`).join("") + `<div class="inline-actions" style="margin-top:4px">
          <button type="button" class="btn btn-ghost btn-small" data-reset-levels="${override ? "1" : ""}"${override ? "" : " disabled"}>Reset to MFE</button>
          <span class="hint">${override ? "Override active — stored with this trade." : "Derived from MFE."}</span>
        </div>`;
      togglesEl.querySelectorAll("[data-level-toggle]").forEach((box) => {
        box.addEventListener("change", () => {
          const next = Array.from(togglesEl.querySelectorAll("[data-level-toggle]")).map((b) => b.checked);
          override = next;
          if (opts.onOverride) opts.onOverride(override);
          refreshPreview();
          renderToggles();
        });
      });
      const reset = togglesEl.querySelector("[data-reset-levels]");
      if (reset) reset.addEventListener("click", () => {
        override = null;
        if (opts.onOverride) opts.onOverride(null);
        renderToggles();
        refreshPreview();
      });
    }

    function read(target) {
      const trade = target || draft;
      trade.tradePath = {
        mfe: A.toNum(mfeInput.value),
        mae: A.toNum(maeInput.value),
        pathComplete: pathInput.checked,
        waypoints: (trade.tradePath || draft.tradePath) ? (trade.tradePath || draft.tradePath).waypoints : null,
      };
      trade.remainderExitR = A.toNum(remainderInput.value);
      trade.finalROverride = A.toNum(finalInput.value);
      trade.exitReason = reasonInput.value || null;
      trade.levelsHitOverride = override ? override.slice() : null;
      return trade;
    }

    function refresh() {
      renderToggles();
      refreshPreview();
    }

    reasonInput.addEventListener("change", () => {
      if (reasonInput.value === "SL") {
        remainderInput.value = "-1";
        pathInput.checked = true;
      } else if (reasonInput.value === "BE") {
        remainderInput.value = "0";
      }
      refreshPreview();
    });

    [mfeInput, maeInput, remainderInput, finalInput].forEach((input) => input.addEventListener("input", () => {
      refreshPreview();
      if (input === mfeInput) renderToggles();
      if (opts.onInput) opts.onInput();
    }));
    pathInput.addEventListener("change", refreshPreview);
    reasonInput.addEventListener("change", refreshPreview);

    renderToggles();
    refreshPreview();

    return {
      element: root,
      read,
      refresh,
      getOverride: () => (override ? override.slice() : null),
      setOverride: (value) => {
        override = value ? value.slice() : null;
        renderToggles();
        refreshPreview();
      },
      refreshPreview,
    };
  }

  function genId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function blankTrade() {
    const last = model.settings.lastEntry || {};
    return {
      id: null,
      tradeNumber: null,
      date: last.date || todayISO(),
      time: "",
      session: last.session || A.DEFAULTS.sessions[1],
      killzone: "",
      instrument: last.instrument || "S&P500",
      direction: last.direction || "Long",
      htfBias: "",
      htfTimeframe: "",
      entryTimeframe: "",
      setup: A.DEFAULTS.setups[0],
      setupQuality: "A",
      entry: null,
      stopLoss: null,
      wickRr: null,
      bodyRr: null,
      spcSl: null,
      riskR: 1,
      exitPlan: (model.settings.lastExitPlan || A.defaultExitPlan()).map((l) => ({ ...l })),
      exitPlanTemplateId: model.settings.lastTemplateId || null,
      exitPlanTemplateName: "",
      tradePath: { mfe: null, mae: null, pathComplete: false, waypoints: null },
      remainderExitR: null,
      levelsHitOverride: null,
      finalROverride: null,
      exitReason: null,
      screenshotBefore: null,
      screenshotAfter: null,
      entryScreenshot: null,
      outcomeScreenshot: null,
      entryScreenshots: [],
      outcomeScreenshots: [],
      notes: "",
      dataset: "",
      isDemo: false,
      status: "open",
      createdAt: null,
      updatedAt: null,
    };
  }

  function clearFormIssues(form) {
    form.querySelectorAll(".field.invalid").forEach((el) => el.classList.remove("invalid"));
    form.querySelectorAll("[data-error-text]").forEach((el) => el.remove());
    form.querySelectorAll(".plan-editor").forEach((el) => el.classList.remove("invalid"));
  }

  function showFormIssues(form, issues) {
    clearFormIssues(form);
    const notices = h("div", { class: "form-notices" });
    issues.forEach((issue) => {
      const fieldName = issue.field === "finalR" ? "finalROverride" : issue.field;
      let wrap = form.querySelector(`[data-wrap="${fieldName}"]`);
      const errHolder = form.querySelector(`[data-errors="${issue.field}"]`);
      if (wrap) wrap.classList.add("invalid");
      if (fieldName === "exitPlan") {
        const editor = form.querySelector(".plan-editor");
        if (editor) editor.classList.add("invalid");
      }
      if (errHolder) {
        const p = h("div", { class: "field-error", "data-error-text": "1", text: issue.message });
        errHolder.appendChild(p);
      } else {
        const row = h("div", { class: "form-notice " + (issue.level === "warning" ? "warn" : "error"), text: issue.message });
        notices.appendChild(row);
      }
    });
    const existing = form.querySelector(".form-notices");
    if (existing) existing.remove();
    if (notices.childNodes.length) form.insertBefore(notices, form.firstChild);
    const firstBad = form.querySelector(".field.invalid");
    if (firstBad) firstBad.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function compressImageToDataUrl(fileOrBlob) {
    return new Promise((resolve, reject) => {
      if (!fileOrBlob) return reject(new Error("No image file provided."));
      if (!(fileOrBlob instanceof Blob)) {
        return reject(new Error("Expected image File or Blob."));
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (!dataUrl || typeof dataUrl !== "string") {
          return reject(new Error("Failed to read image data."));
        }

        const img = new Image();
        img.onload = () => {
          try {
            const max = 1600;
            let width = img.naturalWidth || img.width || 800;
            let height = img.naturalHeight || img.height || 600;

            if (width > max || height > max) {
              const scale = Math.min(max / width, max / height);
              width = Math.max(1, Math.round(width * scale));
              height = Math.max(1, Math.round(height * scale));
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              return resolve(dataUrl);
            }

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.8);
            resolve(jpegDataUrl);
          } catch (err) {
            console.warn("Canvas compression failed, falling back to dataUrl:", err);
            resolve(dataUrl);
          }
        };
        img.onerror = () => {
          reject(new Error("Unable to decode image file."));
        };
        img.src = dataUrl;
      };
      reader.onerror = () => {
        reject(new Error("Failed to read image file."));
      };
      reader.readAsDataURL(fileOrBlob);
    });
  }

  async function uploadToImgBBWithTimeout(base64, name, apiKey, timeoutMs = 15000) {
    if (!apiKey) throw new Error("ImgBB API key not set.");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const form = new FormData();
      form.append("image", base64);
      if (name) form.append("name", String(name).replace(/\.[^.]+$/, ""));
      const response = await fetch("https://api.imgbb.com/1/upload?key=" + encodeURIComponent(apiKey), {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        let detail = "";
        try {
          const j = await response.json();
          detail = j && j.error && j.error.message ? " — " + j.error.message : "";
        } catch (_) {}
        throw new Error("ImgBB upload failed (" + response.status + ")" + detail + ".");
      }
      const json = await response.json();
      if (!json || !json.success || !json.data || !json.data.url) {
        throw new Error("ImgBB: " + (json && json.error && json.error.message ? json.error.message : "Upload rejected."));
      }
      return {
        url: json.data.url,
        displayUrl: json.data.display_url,
        deleteUrl: json.data.delete_url,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function imageFileToBase64(file) {
    const output = await compressImageToDataUrl(file);
    const comma = output.indexOf(",");
    const base64 = comma === -1 ? output : output.slice(comma + 1);
    return {
      base64,
      name: file && file.name ? file.name : "screenshot.jpg",
      width: 1200,
      height: 800,
    };
  }

  async function uploadToImgBB(base64, name) {
    const apiKey = (model && model.settings && model.settings.imgbbApiKey) || (window.ICT_CONFIG && window.ICT_CONFIG.IMGBB_API_KEY);
    if (!apiKey) throw new Error("ImgBB API key not set. Go to Settings → ImgBB API key.");
    return uploadToImgBBWithTimeout(base64, name, apiKey, 15000);
  }

  async function imageFileToScreenshot(file) {
    const { base64, name, width, height } = await imageFileToBase64(file);
    const uploaded = await uploadToImgBB(base64, name);
    return { url: uploaded.url, displayUrl: uploaded.displayUrl, deleteUrl: uploaded.deleteUrl, name, width, height };
  }

  // Multi-image upload field — returns { getValue(), element }
  // Supports multi-file pick, drag-drop, Ctrl+V paste, and direct URL input.
  function createScreenshotListField(options) {
    const opts = options || {};
    let currentUrls = (Array.isArray(opts.initialUrls) ? opts.initialUrls : []).filter(Boolean);

    const root = h("div", { class: "screenshot-field screenshot-list-field", tabindex: "0" });
    const listEl = h("div", { class: "shot-list" });
    const urlInput = h("input", { type: "url", class: "screenshot-url-input", placeholder: "Paste image URL and press Enter…" });
    const fileInput = h("input", { type: "file", accept: "image/*", multiple: "multiple", hidden: "hidden" });
    const uploadBtn = h("button", { type: "button", class: "btn btn-ghost btn-small", text: "Upload images" });
    const addUrlBtn = h("button", { type: "button", class: "btn btn-ghost btn-small", text: "Add URL" });
    const clearBtn = h("button", { type: "button", class: "btn btn-ghost btn-small", text: "Clear all", style: { display: currentUrls.length ? "" : "none" } });
    const statusEl = h("span", { class: "hint" });

    root.appendChild(listEl);
    root.appendChild(urlInput);
    root.appendChild(h("div", { class: "inline-actions", style: { marginTop: "5px" } }, uploadBtn, addUrlBtn, statusEl, clearBtn, fileInput));

    function render() {
      listEl.innerHTML = "";
      currentUrls.forEach((url, index) => {
        const chip = h("div", { class: "shot-chip" });
        chip.appendChild(h("img", { src: url, alt: (opts.label || "Screenshot") + " " + (index + 1) }));
        chip.appendChild(h("span", { class: "shot-name", text: "Image " + (index + 1) }));
        chip.appendChild(h("button", {
          type: "button", class: "icon-btn danger", title: "Remove screenshot", text: "×",
          onclick: () => { currentUrls.splice(index, 1); render(); },
        }));
        listEl.appendChild(chip);
      });
      if (!currentUrls.length) listEl.appendChild(h("p", { class: "muted", style: { margin: "0", fontSize: "12px" }, text: "No images attached." }));
      clearBtn.style.display = currentUrls.length ? "" : "none";
    }

    function addUrl(raw) {
      const url = String(raw || "").trim();
      if (!url || currentUrls.includes(url)) return false;
      currentUrls.push(url);
      render();
      return true;
    }

    function addUrlFromInput() {
      if (addUrl(urlInput.value)) urlInput.value = "";
      urlInput.focus();
    }

    async function handleFiles(files) {
      const list = Array.from(files || []).filter((file) => file && /^image\//.test(file.type));
      if (!list.length) return;
      statusEl.className = "shot-uploading";
      statusEl.textContent = list.length > 1 ? `Uploading ${list.length} images…` : "Uploading…";
      uploadBtn.disabled = true;
      for (const file of list) {
        try {
          const shot = await imageFileToScreenshot(file);
          addUrl(shot.displayUrl || shot.url);
        } catch (err) {
          toast(err.message, { type: "error" });
        }
      }
      statusEl.className = "hint";
      statusEl.textContent = "";
      uploadBtn.disabled = false;
    }

    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = "";
      await handleFiles(files);
    });
    addUrlBtn.addEventListener("click", addUrlFromInput);
    urlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addUrlFromInput();
      }
    });
    clearBtn.addEventListener("click", () => { currentUrls = []; urlInput.value = ""; render(); });

    root.addEventListener("dragover", (e) => { e.preventDefault(); root.classList.add("drag-over"); });
    root.addEventListener("dragleave", () => root.classList.remove("drag-over"));
    root.addEventListener("drop", async (e) => {
      e.preventDefault();
      root.classList.remove("drag-over");
      await handleFiles(e.dataTransfer.files);
    });

    // Paste support — route images to the focused field, defaulting to Entry.
    setTimeout(() => {
      const form = root.closest("form");
      if (!form) return;
      form.addEventListener("paste", async (e) => {
        const active = document.activeElement;
        const focusedField = active && active.closest ? active.closest(".screenshot-list-field") : null;
        const targetField = e.target && e.target.closest ? e.target.closest(".screenshot-list-field") : null;
        const owner = focusedField || targetField;
        if (owner && owner !== root) return;
        if (!owner && !opts.defaultPaste) return;
        const extrasZone = (active && active.closest ? active.closest("[data-shots]") : null) ||
          (e.target && e.target.closest ? e.target.closest("[data-shots]") : null);
        if (extrasZone) return;
        const files = e.clipboardData ? Array.from(e.clipboardData.files || []) : [];
        const img = files.find((f) => /^image\//.test(f.type));
        if (img) { e.preventDefault(); await handleFiles([img]); }
      });
    }, 0);

    render();
    return {
      element: root,
      getValue: () => currentUrls.slice(),
      setValue: (urls) => { currentUrls = (Array.isArray(urls) ? urls : []).filter(Boolean); render(); },
    };
  }

  function screenshotManager(tradeId, host) {
    const state = { existing: [], removed: new Set(), staged: [] };
    const listEl = h("div", { class: "shot-list" });
    const input = h("input", { type: "file", accept: "image/*", multiple: "multiple", hidden: "hidden" });
    const addBtn = h("button", { type: "button", class: "btn btn-ghost btn-small", text: "Add screenshots" });
    const statusEl = h("span", { class: "hint" });
    host.appendChild(listEl);
    host.appendChild(h("div", { class: "inline-actions" }, addBtn, statusEl, input));
    addBtn.addEventListener("click", () => input.click());

    async function addFiles(files) {
      const list = Array.from(files || []).filter((file) => file && /^image\//.test(file.type));
      if (!list.length) return;
      statusEl.className = "shot-uploading";
      statusEl.textContent = list.length > 1 ? `Uploading ${list.length} images…` : "Uploading…";
      addBtn.disabled = true;
      for (const file of list) {
        try {
          const shot = await imageFileToScreenshot(file);
          state.staged.push(Object.assign({ id: genId("shot"), tradeId }, shot));
        } catch (err) {
          toast(err.message, { type: "error" });
        }
      }
      statusEl.className = "hint";
      statusEl.textContent = "";
      addBtn.disabled = false;
      render();
    }

    input.addEventListener("change", async () => {
      const files = Array.from(input.files || []);
      input.value = "";
      await addFiles(files);
    });
    listEl.addEventListener("dragover", (event) => {
      event.preventDefault();
      listEl.classList.add("drag-over");
    });
    listEl.addEventListener("dragleave", () => listEl.classList.remove("drag-over"));
    listEl.addEventListener("drop", async (event) => {
      event.preventDefault();
      listEl.classList.remove("drag-over");
      await addFiles(event.dataTransfer.files);
    });
    const form = host.closest("form");
    if (form) {
      form.addEventListener("paste", async (event) => {
        const target = event.target;
        if (target && target.closest && !host.contains(target)) return;
        const items = event.clipboardData ? Array.from(event.clipboardData.files || []) : [];
        const images = items.filter((file) => /^image\//.test(file.type));
        if (images.length) {
          event.preventDefault();
          await addFiles(images);
        }
      });
    }

    function shotSrc(shot) {
      return shot.displayUrl || shot.url || shot.dataUrl || "";
    }

    function render() {
      listEl.innerHTML = "";
      state.existing.forEach((shot) => {
        if (state.removed.has(shot.id)) return;
        const src = shotSrc(shot);
        const chip = h("div", { class: "shot-chip" });
        chip.appendChild(h("img", { src, alt: shot.name || "Screenshot" }));
        chip.appendChild(h("span", { class: "shot-name", text: shot.name || "Screenshot" }));
        chip.appendChild(h("button", {
          type: "button", class: "icon-btn danger", title: "Remove screenshot", text: "×",
          onclick: () => { state.removed.add(shot.id); render(); },
        }));
        listEl.appendChild(chip);
      });
      state.staged.forEach((shot) => {
        const src = shotSrc(shot);
        const chip = h("div", { class: "shot-chip new" });
        chip.appendChild(h("img", { src, alt: shot.name }));
        chip.appendChild(h("span", { class: "shot-name", text: shot.name }));
        chip.appendChild(h("button", {
          type: "button", class: "icon-btn danger", title: "Remove", text: "×",
          onclick: () => { state.staged = state.staged.filter((s) => s !== shot); render(); },
        }));
        listEl.appendChild(chip);
      });
      if (!listEl.childNodes.length) listEl.appendChild(h("p", { class: "muted", style: { margin: "0", fontSize: "12px" }, text: "No screenshots attached." }));
    }

    render();
    if (tradeId && H.listScreenshots) {
      Promise.resolve(H.listScreenshots(tradeId)).then((shots) => {
        state.existing = shots || [];
        render();
      }).catch(() => {});
    }

    return {
      commit: async (savedId) => {
        for (const id of state.removed) {
          if (H.deleteScreenshot) await H.deleteScreenshot(id);
        }
        for (const shot of state.staged) {
          shot.tradeId = savedId;
          if (H.saveScreenshot) await H.saveScreenshot(shot);
        }
      },
      count: () => state.existing.filter((s) => !state.removed.has(s.id)).length + state.staged.length,
    };
  }

  function openTradeForm(tradeId) {
    const isNew = !tradeId;
    const base = isNew ? blankTrade() : model.allTrades.find((t) => t.id === tradeId);
    if (!base) {
      toast("Trade not found.", { type: "error" });
      return;
    }
    const draft = cloneTrade(base);
    if (isNew) draft.id = genId("trade");
    const blind = !!model.settings.blindMode && isNew;
    const existingCompleted = A.tradeStatus(base) === "completed";
    let includeResult = existingCompleted || (!isNew && base.tradePath && base.tradePath.mfe !== null);
    if (blind) includeResult = false;

    const form = h("form", { class: "trade-form", novalidate: "novalidate" });
    const instruments = A.instrumentList(model.settings);
    const sessions = A.sessionList(model.settings);
    const setups = A.setupList(model.settings);
    const decimals = A.instrumentDecimals(base.instrument || "S&P500", model.settings);

    form.innerHTML = `
      ${blind ? '<div class="form-notice info">Blind mode is on — result fields are hidden while logging this trade. Complete the trade later to record the outcome.</div>' : ""}
      <div class="form-section">
        <h3>Context</h3>
        <div class="form-grid">
          <div class="field" data-wrap="date"><label>Date <b class="req">*</b></label><input type="date" name="date" value="${esc(draft.date || "")}"><div class="field-errors" data-errors="date"></div></div>
          <div class="field"><label>Session</label><select name="session">${optionsHTML(sessions, draft.session, "—")}</select></div>
          <div class="field" data-wrap="instrument"><label>Instrument <b class="req">*</b></label><select name="instrument">${optionsHTML(instruments, draft.instrument, "Select…")}</select><div class="field-errors" data-errors="instrument"></div></div>
          <div class="field" data-wrap="direction"><label>Direction <b class="req">*</b></label><select name="direction">${optionsHTML(A.DEFAULTS.directions, draft.direction)}</select><div class="field-errors" data-errors="direction"></div></div>
          <div class="field"><label>Setup</label><select name="setup">${optionsHTML(setups, draft.setup, "—")}</select></div>
          <div class="field" data-wrap="riskR"><label>Risk (R) <b class="req">*</b></label><input type="number" name="riskR" step="0.01" min="0.01" value="${esc(draft.riskR === null || draft.riskR === undefined ? "" : draft.riskR)}"><span class="hint">1R = normal risk · 0.5R = half risk</span><div class="field-errors" data-errors="riskR"></div></div>
        </div>
        <details class="collapsed-fields" data-optional-context style="margin-top:10px">
          <summary>More context (optional)</summary>
          <div class="form-grid" style="margin-top:8px">
            <div class="field"><label>Time (24h)</label><input type="time" name="time" lang="en-GB" step="60" value="${esc(draft.time || "")}" placeholder="HH:MM"></div>
            <div class="field"><label>Killzone</label><select name="killzone">${optionsHTML(A.DEFAULTS.killzones, draft.killzone, "—")}</select></div>
            <div class="field"><label>Setup quality</label><select name="setupQuality">${optionsHTML(A.DEFAULTS.qualities, draft.setupQuality, "—")}</select></div>
            <div class="field"><label>HTF bias</label><select name="htfBias">${optionsHTML(A.DEFAULTS.htfBiases, draft.htfBias, "—")}</select></div>
            <div class="field"><label>HTF timeframe</label><select name="htfTimeframe">${optionsHTML(A.DEFAULTS.timeframes, draft.htfTimeframe, "—")}</select></div>
            <div class="field"><label>Entry timeframe</label><select name="entryTimeframe">${optionsHTML(A.DEFAULTS.entryTimeframes, draft.entryTimeframe, "—")}</select></div>
          </div>
        </details>
      </div>
      <div class="form-section">
        <h3>Prices &amp; Stop-Loss Modeling</h3>
        <div class="form-grid form-grid-3">
          <div class="field" data-wrap="entry">
            <label>Entry Price <b class="req">*</b></label>
            <input type="number" name="entry" step="any" value="${draft.entry === null || draft.entry === undefined ? "" : draft.entry}" data-price-decimals="${decimals}">
            <div class="field-errors" data-errors="entry"></div>
          </div>
          <div class="field" data-wrap="stopLoss">
            <label>Stop Loss <b class="req">*</b></label>
            <input type="number" name="stopLoss" step="any" value="${draft.stopLoss === null || draft.stopLoss === undefined ? "" : draft.stopLoss}" data-price-decimals="${decimals}">
            <div class="field-errors" data-errors="stopLoss"></div>
          </div>
          <div class="field">
            <label>Risk Distance</label>
            <div class="static-readout" data-risk-distance>—</div>
          </div>
        </div>
        <div class="form-grid form-grid-3" style="margin-top:10px">
          <div class="field" data-wrap="wickRr">
            <label>Wick SL (R:R)</label>
            <input type="text" name="wickRr" value="${esc(draft.wickRr || '')}" placeholder="e.g. 1:6R or 6">
            <span class="hint">Manual Wick stop R:R</span>
            <div class="field-errors" data-errors="wickRr"></div>
          </div>
          <div class="field" data-wrap="bodyRr">
            <label>Body SL (R:R)</label>
            <input type="text" name="bodyRr" value="${esc(draft.bodyRr || '')}" placeholder="e.g. 1:7.5R or 7.5">
            <span class="hint">Manual Body stop R:R</span>
            <div class="field-errors" data-errors="bodyRr"></div>
          </div>
          <div class="field" data-wrap="spcSl">
            <label>SPC SL (R:R)</label>
            <input type="text" name="spcSl" value="${esc(draft.spcSl || '')}" placeholder="e.g. 6.4 or -1">
            <span class="hint">Manual Space stop R:R</span>
            <div class="field-errors" data-errors="spcSl"></div>
          </div>
        </div>
      </div>
      <div class="form-section" data-entry-shot-section>
        <h3>Entry Screenshot</h3>
        <div class="field" data-wrap="entryScreenshot">
          <div data-entry-shot></div>
          <span class="hint">Upload one or more entry charts or add image URLs.</span>
        </div>
      </div>
      ${blind ? "" : `<div class="form-section" data-outcome-shot-section>
        <h3>Outcome Screenshot</h3>
        <div class="field" data-wrap="outcomeScreenshot">
          <div data-outcome-shot></div>
          <span class="hint">Optional. Upload one or more final price-action charts or add image URLs.</span>
        </div>
      </div>`}
      <div class="form-section">
        <h3>Exit Plan <span class="hint" style="text-transform:none;letter-spacing:normal;font-weight:400">Allocations must total 100%</span></h3>
        <div data-plan-host></div>
        <div class="field-errors" data-errors="exitPlan" style="margin-top:4px"></div>
      </div>
      <div class="form-section" data-result-section${includeResult ? "" : ' style="display:none"'}>
        <h3>Result ${blind ? "" : ""}</h3>
        <div data-result-host></div>
      </div>
      <div class="form-section">
        <details class="collapsed-fields" data-notes-section>
          <summary>Notes, batch &amp; additional screenshots (optional)</summary>
          <div class="field" style="margin-top:8px"><textarea name="notes" rows="3" placeholder="What was the story? What would you repeat or avoid?">${esc(draft.notes || "")}</textarea></div>
          <div class="form-grid" style="margin-top:10px">
            <div class="field"><label>Batch</label><input type="text" name="dataset" value="${esc(draft.dataset || "")}" placeholder="e.g. Backtest Batch 1"></div>
            <div class="field"><label>Additional Screenshots</label><div data-shots></div><span class="hint">Extra context images; multiple uploads supported.</span></div>
          </div>
        </details>
      </div>
      ${blind ? "" : `<div class="form-section">
        <label class="complete-toggle"><input type="checkbox" name="includeResult"${includeResult ? " checked" : ""}> <span>Mark trade as complete</span><span class="hint">Adds the trade to analytics and equity.</span></label>
      </div>`}`;

    if (blind) {
      ["time", "killzone", "setupQuality", "htfBias", "htfTimeframe", "entryTimeframe", "riskR"].forEach((name) => {
        const input = form.querySelector('[name="' + name + '"]');
        const field = input ? input.closest(".field") : null;
        if (field) field.style.display = "none";
      });
      const optional = form.querySelector("[data-optional-context]");
      if (optional) optional.style.display = "none";
      const notes = form.querySelector('[name="notes"]');
      if (notes) {
        const section = notes.closest(".form-section");
        if (section) section.style.display = "none";
      }
    }

    const planHost = form.querySelector("[data-plan-host]");
    const resultHost = form.querySelector("[data-result-host]");
    const resultSection = form.querySelector("[data-result-section]");
    const includeBox = form.querySelector('[name="includeResult"]');
    const entryInput = form.querySelector('[name="entry"]');
    const slInput = form.querySelector('[name="stopLoss"]');
    const directionInput = form.querySelector('[name="direction"]');
    const riskInput = form.querySelector('[name="riskR"]');
    const timeInput = form.querySelector('[name="time"]');
    const sessionInput = form.querySelector('[name="session"]');
    const riskDistanceEl = form.querySelector("[data-risk-distance]");
    const wickRrInput = form.querySelector('[name="wickRr"]');
    const bodyRrInput = form.querySelector('[name="bodyRr"]');
    const spcSlInput = form.querySelector('[name="spcSl"]');
    if (wickRrInput) {
      const onWickChange = (e) => { draft.wickRr = e.target.value; };
      wickRrInput.addEventListener("input", onWickChange);
      wickRrInput.addEventListener("change", onWickChange);
    }
    if (bodyRrInput) {
      const onBodyChange = (e) => { draft.bodyRr = e.target.value; };
      bodyRrInput.addEventListener("input", onBodyChange);
      bodyRrInput.addEventListener("change", onBodyChange);
    }
    if (spcSlInput) {
      const onSpcChange = (e) => { draft.spcSl = e.target.value; };
      spcSlInput.addEventListener("input", onSpcChange);
      spcSlInput.addEventListener("change", onSpcChange);
    }

    const shotHost = form.querySelector("[data-shots]");
    const shots = blind ? null : screenshotManager(isNew ? null : base.id, shotHost);
    const entryShot = createScreenshotListField({ initialUrls: A.screenshotUrls(draft, "entry"), label: "Entry screenshot", defaultPaste: true });
    form.querySelector("[data-entry-shot]").appendChild(entryShot.element);
    const outcomeShotHost = form.querySelector("[data-outcome-shot]");
    const outcomeShot = outcomeShotHost ? createScreenshotListField({ initialUrls: A.screenshotUrls(draft, "outcome"), label: "Outcome screenshot" }) : null;
    if (outcomeShot) outcomeShotHost.appendChild(outcomeShot.element);

    if (timeInput && sessionInput && model.settings.autoSession && model.settings.marketTimeZone) {
      let userTouched = !isNew;
      const suggest = () => {
        if (userTouched) return;
        const next = A.sessionFromTime(timeInput.value);
        if (next) sessionInput.value = next;
      };
      sessionInput.addEventListener("change", () => { userTouched = true; });
      timeInput.addEventListener("change", suggest);
      if (timeInput.value) suggest();
    }

    let resultFields = null;
    const planEditor = createPlanEditor({
      levels: draft.exitPlan,
      templateId: draft.exitPlanTemplateId,
      templates: model.templates,
      getTrade: () => {
        const mfeEl = form.querySelector('[name="mfe"]');
        const maeEl = form.querySelector('[name="mae"]');
        const riskEl = form.querySelector('[name="riskR"]');
        return Object.assign({}, draft, {
          instrument: form.querySelector('[name="instrument"]').value || draft.instrument,
          entry: A.toNum(entryInput.value),
          stopLoss: A.toNum(slInput.value),
          direction: directionInput.value,
          riskR: A.toNum(riskEl.value),
          tradePath: { mfe: mfeEl ? A.toNum(mfeEl.value) : null, mae: maeEl ? A.toNum(maeEl.value) : null, pathComplete: false, waypoints: null },
          finalROverride: A.toNum(form.querySelector('[name="finalROverride"]') ? form.querySelector('[name="finalROverride"]').value : null),
        });
      },
      onChange: () => {
        if (resultFields) resultFields.refreshPreview();
      },
      onSaveTemplate: async (name, levels) => {
        const tpl = { id: genId("tpl"), name, levels, createdAt: new Date().toISOString() };
        if (H.saveTemplate) await H.saveTemplate(tpl);
        toast('Template "' + name + '" saved.', { type: "success" });
      },
    });
    planHost.appendChild(planEditor.element);

    if (!blind) {
      resultFields = createResultFields({
        draft,
        getLevels: () => planEditor.getLevels(),
        getRisk: () => A.toNum(riskInput.value) || 1,
        onOverride: () => {},
        onInput: () => planEditor.refresh(),
      });
      resultHost.appendChild(resultFields.element);
      planEditor.refresh();
    }

    function updateRiskDistance() {
      const entry = A.toNum(entryInput.value);
      const sl = A.toNum(slInput.value);

      const decimals = A.instrumentDecimals(form.querySelector('[name="instrument"]').value, model.settings);
      form.querySelectorAll("[data-price-decimals]").forEach((input) => {
        const val = A.toNum(input.value);
        if (val !== null && input !== document.activeElement) input.value = String(A.clampNumber(val, decimals));
      });

      if (entry === null || sl === null) {
        riskDistanceEl.textContent = "—";
        riskDistanceEl.classList.remove("bad");
      } else if (entry === sl) {
        riskDistanceEl.textContent = "Zero — invalid";
        riskDistanceEl.classList.add("bad");
      } else {
        riskDistanceEl.textContent = A.formatPrice(Math.abs(entry - sl), decimals);
        riskDistanceEl.classList.remove("bad");
      }
    }

    [entryInput, slInput, directionInput, form.querySelector('[name="instrument"]')].filter(Boolean).forEach((input) => {
      const handler = () => {
        updateRiskDistance();
        planEditor.refresh();
      };
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    });
    riskInput.addEventListener("input", () => {
      planEditor.refresh();
      if (resultFields) resultFields.refreshPreview();
    });

    if (includeBox) {
      includeBox.addEventListener("change", () => {
        includeResult = includeBox.checked;
        resultSection.style.display = includeResult ? "" : "none";
        if (!includeResult && resultFields) {
          resultFields.element.querySelectorAll("input, select").forEach((el) => {
            if (el.type === "checkbox") el.checked = false;
            else el.value = "";
          });
        }
      });
    }

    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => entry.close("cancel") }));
    const saveBtn = h("button", { type: "button", class: "btn btn-primary", text: isNew ? "Create trade" : "Save changes", onclick: () => form.requestSubmit() });
    footer.appendChild(saveBtn);

    const entry = openModal({
      title: isNew ? "New Trade" : "Edit Trade",
      subtitle: isNew ? "Log a setup. Add the result now or complete it later." : (base.isDemo ? "Demo trade — edits do not change the generator's data." : "Editing trade #" + (base.tradeNumber || "—")),
      size: "modal-lg",
      body: form,
      footer,
      focus: '[name="date"]',
      onClose: (reason) => {
        if (reason === "cancel" || reason === "escape") return;
      },
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const complete = blind ? false : !!(includeBox && includeBox.checked);
      if (!isNew && existingCompleted && !complete && !blind) {
        const ok = await confirm({
          title: "Remove result data?",
          message: "This trade will return to Open and its recorded result fields will be cleared.",
          confirmLabel: "Remove result",
          danger: true,
        });
        if (!ok) return;
      }
      const next = formToDraft(form, draft, planEditor, resultFields, complete);
      const entryUrls = entryShot.getValue();
      next.entryScreenshots = entryUrls;
      next.entryScreenshot = entryUrls[0] || null;
      if (outcomeShot) {
        const outcomeUrls = outcomeShot.getValue();
        next.outcomeScreenshots = outcomeUrls;
        next.outcomeScreenshot = outcomeUrls[0] || null;
      } else {
        next.outcomeScreenshots = [];
        next.outcomeScreenshot = null;
      }
      if (!next.date) {
        showFormIssues(form, [{ field: "date", message: "A valid date is required.", level: "error" }]);
        return;
      }
      next.status = complete ? "completed" : "open";
      if (complete) {
        next.tradePath = {
          mfe: A.toNum(form.querySelector('[name="mfe"]').value),
          mae: A.toNum(form.querySelector('[name="mae"]').value),
          pathComplete: !!form.querySelector('[name="pathComplete"]').checked,
          waypoints: draft.tradePath ? draft.tradePath.waypoints : null,
        };
        next.remainderExitR = A.toNum(form.querySelector('[name="remainderExitR"]').value);
        next.finalROverride = A.toNum(form.querySelector('[name="finalROverride"]').value);
        next.exitReason = form.querySelector('[name="exitReason"]').value || null;
        next.levelsHitOverride = resultFields.getOverride();
      } else {
        next.tradePath = { mfe: null, mae: null, pathComplete: false, waypoints: null };
        next.remainderExitR = null;
        next.finalROverride = null;
        next.exitReason = null;
        next.levelsHitOverride = null;
      }
      const check = A.validateTrade(next, { requireComplete: complete });
      const issues = check.errors.slice();
      if (complete && A.finalR(next) === null) {
        issues.push({ field: "finalROverride", message: "A completed trade needs a computable Final R. Enter MFE (and a remainder) or set a manual override.", level: "error" });
      }
      if (issues.length) {
        showFormIssues(form, issues.concat(check.warnings.map((w) => ({ ...w, level: "warning" }))));
        return;
      }
      if (check.warnings.length) {
        const ok = await confirm({
          title: "Warnings",
          message: "Save anyway?",
          details: check.warnings.map((w) => w.message),
          confirmLabel: "Save",
        });
        if (!ok) return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        next.updatedAt = new Date().toISOString();
        if (isNew) next.createdAt = next.updatedAt;
        next.isDemo = !!base.isDemo;
        if (H.saveTrade) await H.saveTrade(next);
        if (shots) await shots.commit(next.id);
        model.settings.lastEntry = { date: next.date, instrument: next.instrument, session: next.session, direction: next.direction };
        model.settings.lastExitPlan = planEditor.getLevels();
        model.settings.lastTemplateId = planEditor.getTemplateId();
        if (H.saveSettings) await H.saveSettings(model.settings);
        entry.close("save");
        toast(isNew ? "Trade created." : "Trade updated.", { type: "success" });
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = isNew ? "Create trade" : "Save changes";
        toast(err && err.message ? err.message : "Could not save trade.", { type: "error" });
      }
    });

    updateRiskDistance();
  }

  function formToDraft(form, draft, planEditor, resultFields, complete) {
    const get = (name) => form.querySelector('[name="' + name + '"]');
    const next = Object.assign({}, draft);
    next.date = get("date").value;
    next.time = get("time").value;
    next.session = get("session").value;
    next.killzone = get("killzone").value;
    next.instrument = get("instrument").value;
    next.direction = get("direction").value;
    next.setup = get("setup").value;
    next.setupQuality = get("setupQuality").value;
    next.htfBias = get("htfBias").value;
    next.htfTimeframe = get("htfTimeframe").value;
    next.entryTimeframe = get("entryTimeframe").value;
    next.entry = A.toNum(get("entry").value);
    next.stopLoss = A.toNum(get("stopLoss").value);
    const wickEl = form.querySelector('[name="wickRr"]');
    const bodyEl = form.querySelector('[name="bodyRr"]');
    const spcEl = form.querySelector('[name="spcSl"]');
    const wickVal = wickEl ? wickEl.value.trim() : (draft && draft.wickRr !== undefined && draft.wickRr !== null ? String(draft.wickRr).trim() : "");
    const bodyVal = bodyEl ? bodyEl.value.trim() : (draft && draft.bodyRr !== undefined && draft.bodyRr !== null ? String(draft.bodyRr).trim() : "");
    const spcVal = spcEl ? spcEl.value.trim() : (draft && draft.spcSl !== undefined && draft.spcSl !== null ? String(draft.spcSl).trim() : "");
    next.wickRr = wickVal ? (A.toNum(wickVal) !== null ? A.toNum(wickVal) : wickVal) : null;
    next.bodyRr = bodyVal ? (A.toNum(bodyVal) !== null ? A.toNum(bodyVal) : bodyVal) : null;
    next.spcSl = spcVal ? (A.toNum(spcVal) !== null ? A.toNum(spcVal) : spcVal) : null;
    if (draft) {
      draft.wickRr = next.wickRr;
      draft.bodyRr = next.bodyRr;
      draft.spcSl = next.spcSl;
    }
    next.riskR = A.toNum(get("riskR").value);
    next.notes = get("notes").value;
    next.dataset = get("dataset") ? get("dataset").value : "";
    next.exitPlan = planEditor.getLevels();
    const templateId = planEditor.getTemplateId();
    next.exitPlanTemplateId = templateId || null;
    const tpl = templateId ? (model.templates || []).find((t) => t.id === templateId) : null;
    next.exitPlanTemplateName = tpl ? tpl.name : "";
    if (complete && resultFields) resultFields.read(next);
    return next;
  }

  function openCompleteForm(trade) {
    if (!trade) return;
    const draft = cloneTrade(trade);
    const form = h("form", { class: "trade-form", novalidate: "novalidate" });
    const planText = A.planString(trade.exitPlan);
    form.innerHTML = `<div class="complete-summary">
        <div><span class="label">Trade</span><span>#${esc(trade.tradeNumber || "—")} · ${esc(trade.instrument || "")} ${esc(trade.direction || "")}</span></div>
        <div><span class="label">Date</span><span>${esc(trade.date || "")}</span></div>
        <div><span class="label">Entry → SL</span><span>${esc(trade.entry)} → ${esc(trade.stopLoss)}</span></div>
        <div><span class="label">Exit Plan</span><span class="mono">${esc(planText)}</span></div>
      </div>
      <div data-result-host></div>
      <div class="form-section" data-outcome-shot-section>
        <h3>Outcome Screenshot</h3>
        <div class="field" data-wrap="outcomeScreenshot">
          <div data-outcome-shot></div>
          <span class="hint">Upload one or more final price-action charts or add image URLs. Entry screenshots are kept separately.</span>
        </div>
      </div>`;

    const resultFields = createResultFields({
      draft,
      getLevels: () => trade.exitPlan,
      onOverride: () => {},
    });
    form.querySelector("[data-result-host]").appendChild(resultFields.element);
    const outcomeShot = createScreenshotListField({ initialUrls: A.screenshotUrls(draft, "outcome"), label: "Outcome screenshot", defaultPaste: true });
    form.querySelector("[data-outcome-shot]").appendChild(outcomeShot.element);

    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => entry.close("cancel") }));
    const saveBtn = h("button", { type: "button", class: "btn btn-primary", text: "Save result", onclick: () => form.requestSubmit() });
    footer.appendChild(saveBtn);

    const entry = openModal({
      title: A.tradeStatus(trade) === "completed" ? "Edit Result" : "Complete Trade",
      subtitle: "Record the outcome. Analytics and the equity curve update immediately.",
      size: "modal-lg",
      body: form,
      footer,
      focus: '[name="mfe"]',
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = cloneTrade(trade);
      resultFields.read(next);
      const outcomeUrls = outcomeShot.getValue();
      next.outcomeScreenshots = outcomeUrls;
      next.outcomeScreenshot = outcomeUrls[0] || null;
      next.status = "completed";
      next.updatedAt = new Date().toISOString();
      const check = A.validateTrade(next);
      const issues = check.errors.slice();
      if (A.finalR(next) === null) {
        issues.push({ field: "finalROverride", message: "Final R is still incomplete. Enter MFE and a remainder exit, or set a manual override.", level: "error" });
      }
      if (issues.length) {
        showFormIssues(form, issues.concat(check.warnings.map((w) => ({ ...w, level: "warning" }))));
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        if (H.saveTrade) await H.saveTrade(next);
        entry.close("save");
        toast("Result saved.", { type: "success" });
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save result";
        toast(err && err.message ? err.message : "Could not save result.", { type: "error" });
      }
    });
  }

  function ensureDetailsPanel() {
    if (byId("details-panel")) return;
    const backdrop = h("div", { id: "details-backdrop", class: "details-backdrop", hidden: "hidden" });
    const panel = h("aside", { id: "details-panel", class: "details-panel", hidden: "hidden", "aria-label": "Trade details" });
    panel.innerHTML = `<div class="details-head">
        <div><h2 id="details-title"></h2><p id="details-sub"></p></div>
        <button type="button" class="modal-close" id="details-close" aria-label="Close details">×</button>
      </div>
      <div id="details-body" class="details-body"></div>`;
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    backdrop.addEventListener("click", closeDetails);
    byId("details-close").addEventListener("click", closeDetails);
  }

  function openDetails(id) {
    ensureDetailsPanel();
    detailsId = id;
    byId("details-panel").hidden = false;
    byId("details-backdrop").hidden = false;
    document.body.classList.add("details-open");
    renderDetails();
  }

  function closeDetails() {
    if (!detailsId) return;
    detailsId = null;
    const panel = byId("details-panel");
    if (panel) panel.hidden = true;
    const backdrop = byId("details-backdrop");
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("details-open");
  }

  function renderDetails() {
    if (!detailsId) return;
    const trade = model.allTrades.find((t) => t.id === detailsId);
    if (!trade) {
      closeDetails();
      return;
    }
    const title = byId("details-title");
    const sub = byId("details-sub");
    const body = byId("details-body");
    if (!title || !body) return;

    title.textContent = "Trade #" + (trade.tradeNumber || "—");
    // Render instrument + session as colored pills in the sub-heading
    const insKey = (trade.instrument || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const insClass = ["nas100","us500","xauusd","eurusd","gbpusd"].includes(insKey) ? " pill-ins-" + insKey : "";
    const sesRaw = trade.session || "";
    const sesKey = sesRaw.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const sesMap = { "asia": "asia", "london": "london", "new-york-am": "nyam", "new-york-pm": "nypm" };
    const sesClass = sesMap[sesKey] ? " pill-ses-" + sesMap[sesKey] : "";
    const insPill = trade.instrument ? `<span class="pill${insClass}">${esc(trade.instrument)}</span>` : "";
    const sesPill = sesRaw ? `<span class="pill${sesClass}">${esc(sesRaw)}</span>` : "";
    const subParts = [trade.date, trade.time, trade.direction].filter(Boolean).map(esc).join(" · ");
    sub.innerHTML = (subParts ? subParts + " · " : "") + [insPill, sesPill].filter(Boolean).join(" ");

    const levels = A.normalizeLevels(trade.exitPlan);
    const hits = A.levelHitState(trade);
    const statusBadge = trade.status === "completed"
      ? `<span class="pill pill-good">Completed</span>`
      : `<span class="pill pill-warn">Incomplete</span>`;
    const planRows = levels.map((lvl, idx) => {
      const price = A.targetPriceForTrade(trade, lvl.targetR);
      const hit = hits.hit[idx];
      return `<div class="detail-level${hit ? " hit" : ""}">
        <span class="detail-dot"></span>
        <span class="detail-lvl">${A.formatAllocation(lvl.allocation)}% @ ${A.formatTargetR(lvl.targetR)}R</span>
        <span class="detail-price">${fmtPrice(price, trade)}</span>
        <span class="detail-state">${hit ? "hit" : "not hit"}</span>
      </div>`;
    }).join("") || '<p class="muted">No Exit Plan levels.</p>';

    body.innerHTML = `
      <div class="details-badges">
        ${statusBadge}
        ${trade.isDemo ? '<span class="pill">Demo</span>' : ""}
        ${trade.isCopy ? '<span class="pill" title="Copy of another trade">Copy</span>' : ""}
        ${trade.setupQuality ? `<span class="pill">${esc(trade.setupQuality)}</span>` : ""}
        ${trade.setup ? `<span class="pill pill-accent">${esc(A.setupComponents(trade).join(" + "))}</span>` : ""}
      </div>
      <div class="details-actions">
        <button type="button" class="btn btn-primary btn-small" data-detail-action="edit">Edit</button>
        <button type="button" class="btn btn-ghost btn-small" data-detail-action="complete">${trade.status === "completed" ? "Edit result" : "Complete"}</button>
        <button type="button" class="btn btn-ghost btn-small" data-detail-action="duplicate">Duplicate</button>
        <button type="button" class="btn btn-ghost btn-small danger" data-detail-action="delete">Delete</button>
      </div>
      <div class="detail-section">
        <h3>Result</h3>
        <div class="detail-metrics">
          <div><span>Final R</span><b class="${signedClass(trade.finalR)}">${trade.finalR === null ? "—" : A.formatR(trade.finalR)}</b></div>
          <div><span>MFE</span><b>${trade.mfe === null ? "—" : A.formatNumber(trade.mfe, 2) + "R"}</b></div>
          <div><span>MAE</span><b>${trade.mae === null ? "—" : A.formatNumber(trade.mae, 2) + "R"}</b></div>
          <div><span>Rem. Exit R</span><b class="${signedClass(trade.effectiveRemainder)}">${trade.effectiveRemainder === null ? "—" : A.formatR(trade.effectiveRemainder)}</b></div>
          <div><span>Exit</span><b>${esc(trade.exitReason || "—")}</b></div>
          <div><span>Path complete</span><b>${trade.pathComplete ? "Yes" : "No"}</b></div>
          <div><span>Levels hit</span><b>${esc(trade.levelsHitLabel || "—")}</b></div>
          <div><span>Risk</span><b>${A.formatNumber(trade.riskR, 2)}R</b></div>
        </div>
        ${A.toNum(trade.finalROverride) !== null ? '<p class="hint">Final R uses a manual override.</p>' : ""}
        ${hits.overridden ? '<p class="hint">Levels Hit uses an override stored with this trade.</p>' : ""}
      </div>
      <div class="detail-section">
        <h3>Prices</h3>
        <div class="detail-metrics">
          <div><span>Entry</span><b>${fmtPrice(trade.entry, trade)}</b></div>
          <div><span>Stop Loss</span><b>${fmtPrice(trade.stopLoss, trade)}</b></div>
          <div><span>Wick SL (R:R)</span><b>${trade.wickRr ? esc(String(trade.wickRr)) : "—"}</b></div>
          <div><span>Body SL (R:R)</span><b>${trade.bodyRr ? esc(String(trade.bodyRr)) : "—"}</b></div>
          <div><span>SPC SL (R:R)</span><b>${trade.spcSl ? esc(String(trade.spcSl)) : "—"}</b></div>
          <div><span>Risk distance</span><b>${trade.rDistance === null ? "—" : fmtPrice(trade.rDistance, trade)}</b></div>
          <div><span>Exit Plan</span><b class="mono">${esc(A.planString(trade.exitPlan))}</b></div>
        </div>
      </div>
      <div class="detail-section">
        <h3>Exit Plan ladder</h3>
        <div class="detail-levels">${planRows}</div>
      </div>
      <div class="detail-section">
        <h3>Context</h3>
        <div class="detail-metrics">
          <div><span>Killzone</span><b>${esc(trade.killzone || "—")}</b></div>
          <div><span>HTF bias</span><b>${esc(trade.htfBias || "—")}</b></div>
          <div><span>HTF TF</span><b>${esc(trade.htfTimeframe || "—")}</b></div>
          <div><span>Entry TF</span><b>${esc(trade.entryTimeframe || "—")}</b></div>
          <div><span>Batch</span><b>${esc(trade.dataset || "—")}</b></div>
          <div><span>Waypoints</span><b>${esc(trade.tradePath && trade.tradePath.waypoints ? trade.tradePath.waypoints.join(", ") : "—")}</b></div>
        </div>
      </div>
      <div class="detail-section">
        <h3>Notes</h3>
        <p class="detail-notes">${esc(trade.notes || "No notes.")}</p>
      </div>
      <div class="detail-section">
        <h3>Entry Screenshots <span class="hint" data-entry-shot-count></span></h3>
        <div class="details-shots" data-entry-shots><p class="muted">Loading…</p></div>
      </div>
      <div class="detail-section">
        <h3>Outcome Screenshots <span class="hint" data-outcome-shot-count></span></h3>
        <div class="details-shots" data-outcome-shots><p class="muted">Loading…</p></div>
      </div>
      <div class="detail-section">
        <h3>Additional Screenshots <span class="hint" data-extra-shot-count></span></h3>
        <div class="details-shots" data-extra-shots><p class="muted">Loading…</p></div>
      </div>`;

    body.querySelector('[data-detail-action="edit"]').addEventListener("click", () => openTradeForm(trade.id));
    body.querySelector('[data-detail-action="complete"]').addEventListener("click", () => openCompleteForm(trade));
    body.querySelector('[data-detail-action="duplicate"]').addEventListener("click", async () => {
      const copy = await H.duplicateTrade(trade.id);
      if (copy && copy.id) {
        toast("Trade duplicated.", { type: "success" });
        openDetails(copy.id);
      }
    });
    body.querySelector('[data-detail-action="delete"]').addEventListener("click", async () => {
      const shots = await Promise.resolve(H.listScreenshots ? H.listScreenshots(trade.id) : []);
      const ok = await confirm({
        title: "Delete trade?",
        message: "Trade #" + (trade.tradeNumber || "—") + " and its " + ((shots && shots.length) || 0) + " screenshot(s) will be permanently deleted.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const snapshot = await H.deleteTrade(trade.id);
      closeDetails();
      toast("Trade deleted.", {
        type: "success",
        actionLabel: "Undo",
        duration: 15000,
        onAction: async () => {
          await H.restoreTrade(snapshot);
          toast("Trade restored.", { type: "success" });
        },
      });
    });

    const entryShotsEl = body.querySelector("[data-entry-shots]");
    const outcomeShotsEl = body.querySelector("[data-outcome-shots]");
    const extraShotsEl = body.querySelector("[data-extra-shots]");
    const entryCountEl = body.querySelector("[data-entry-shot-count]");
    const outcomeCountEl = body.querySelector("[data-outcome-shot-count]");
    const extraCountEl = body.querySelector("[data-extra-shot-count]");

    const addFigure = (target, src, name, shot) => {
      const fig = h("figure", { class: "detail-shot" });
      const img = h("img", { src, alt: name, loading: "lazy" });
      img.addEventListener("click", () => {
        openModal({
          title: name,
          size: "modal-lg",
          body: `<div class="lightbox"><img src="${esc(src)}" alt="${esc(name)}"></div>`,
        });
      });
      const cap = h("figcaption", { text: name });
      fig.appendChild(img);
      fig.appendChild(cap);
      if (shot) {
        const del = h("button", { type: "button", class: "icon-btn danger", title: "Delete screenshot", text: "×" });
        del.addEventListener("click", async () => {
          const ok = await confirm({ title: "Delete screenshot?", message: "This image will be permanently removed.", confirmLabel: "Delete", danger: true });
          if (!ok) return;
          await H.deleteScreenshot(shot.id);
          toast("Screenshot deleted.", { type: "success" });
          renderDetails();
        });
        fig.appendChild(del);
      }
      target.appendChild(fig);
    };

    const renderDedicated = (target, countEl, urls, label, emptyMessage) => {
      target.innerHTML = "";
      if (countEl) countEl.textContent = urls.length ? "· " + urls.length : "";
      if (!urls.length) {
        target.innerHTML = '<p class="muted">' + emptyMessage + '</p>';
        return;
      }
      urls.forEach((src, index) => addFigure(target, src, urls.length > 1 ? label + " " + (index + 1) : label, null));
    };

    renderDedicated(entryShotsEl, entryCountEl, A.screenshotUrls(trade, "entry"), "Entry screenshot", "No entry screenshots attached.");
    renderDedicated(outcomeShotsEl, outcomeCountEl, A.screenshotUrls(trade, "outcome"), "Outcome screenshot", "No outcome screenshots attached.");

    Promise.resolve(H.listScreenshots ? H.listScreenshots(trade.id) : []).then((shots) => {
      const list = shots || [];
      if (extraCountEl) extraCountEl.textContent = list.length ? "· " + list.length : "";
      extraShotsEl.innerHTML = "";
      if (list.length) list.forEach((shot) => addFigure(extraShotsEl, shot.displayUrl || shot.url || shot.dataUrl || "", shot.name || "Screenshot", shot));
      else extraShotsEl.innerHTML = '<p class="muted">No additional screenshots.</p>';
    }).catch(() => {
      if (extraCountEl) extraCountEl.textContent = "";
      if (extraShotsEl) extraShotsEl.innerHTML = '<p class="muted">Could not load additional screenshots.</p>';
    });
  }

  function openTemplatesModal() {
    const body = h("div", { class: "templates-modal" });
    const listHost = h("div", { class: "template-list" });
    body.appendChild(h("div", { class: "inline-actions", style: { marginBottom: "10px" } },
      h("span", { class: "muted", text: "Reusable Exit Plans. Editing a plan never changes trades already recorded with it." })
    ));
    body.appendChild(listHost);
    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Close", onclick: () => entry.close("close") }));
    const addBtn = h("button", { type: "button", class: "btn btn-primary", text: "+ New Exit Plan" });
    footer.appendChild(addBtn);

    const entry = openModal({
      title: "Exit Plans",
      subtitle: "Templates for consistent multi-target management.",
      size: "modal-md",
      body,
      footer,
    });
    addBtn.addEventListener("click", () => openTemplateForm(null, refresh));

    function refresh() {
      const templates = model.templates || [];
      if (!templates.length) {
        listHost.innerHTML = '<div class="empty-state" style="padding:24px"><p>No Exit Plans yet.</p><button type="button" class="btn btn-primary btn-small" data-tpl-new>Create your first plan</button></div>';
        const btn = listHost.querySelector("[data-tpl-new]");
        if (btn) btn.addEventListener("click", () => openTemplateForm(null, refresh));
        return;
      }
      listHost.innerHTML = templates.map((tpl) => `<div class="template-row">
          <div class="template-main">
            <div class="template-name">${esc(tpl.name)}</div>
            <div class="template-levels mono">${esc(A.planString(tpl.levels))}</div>
          </div>
          <div class="template-actions">
            <button type="button" class="btn btn-ghost btn-small" data-tpl-edit="${esc(tpl.id)}">Edit</button>
            <button type="button" class="btn btn-ghost btn-small" data-tpl-dup="${esc(tpl.id)}">Duplicate</button>
            <button type="button" class="btn btn-ghost btn-small danger" data-tpl-del="${esc(tpl.id)}">Delete</button>
          </div>
        </div>`).join("");
      listHost.querySelectorAll("[data-tpl-edit]").forEach((btn) => btn.addEventListener("click", () => {
        const tpl = templates.find((t) => t.id === btn.dataset.tplEdit);
        if (tpl) openTemplateForm(tpl, refresh);
      }));
      listHost.querySelectorAll("[data-tpl-dup]").forEach((btn) => btn.addEventListener("click", async () => {
        const tpl = templates.find((t) => t.id === btn.dataset.tplDup);
        if (!tpl) return;
        await H.saveTemplate({ id: genId("tpl"), name: tpl.name + " copy", levels: tpl.levels.map((l) => ({ ...l })), createdAt: new Date().toISOString() });
        toast("Exit Plan duplicated.", { type: "success" });
        refresh();
      }));
      listHost.querySelectorAll("[data-tpl-del]").forEach((btn) => btn.addEventListener("click", async () => {
        const tpl = templates.find((t) => t.id === btn.dataset.tplDel);
        if (!tpl) return;
        let usage = 0;
        if (H.countTemplateUsage) usage = await H.countTemplateUsage(tpl.id);
        const ok = await confirm({
          title: "Delete Exit Plan?",
          message: '"' + tpl.name + '" will be removed.' + (usage ? " " + usage + " trade(s) reference it; their stored plans are kept." : ""),
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        await H.deleteTemplate(tpl.id);
        toast("Exit Plan deleted.", { type: "success" });
        refresh();
      }));
    }

    refresh();
  }

  function openTemplateForm(template, onSaved) {
    const isNew = !template;
    const base = template || { id: genId("tpl"), name: "", levels: A.defaultExitPlan() };
    const form = h("form", { class: "trade-form", novalidate: "novalidate" });
    form.innerHTML = `<div class="form-grid">
        <div class="field" style="grid-column:1/-1"><label>Plan name</label><input type="text" name="name" value="${esc(base.name)}" placeholder="e.g. 4R Runner"></div>
      </div>
      <div class="section-title" style="margin-top:12px">Levels</div>
      <div data-plan-host></div>
      <div class="field-errors" data-plan-errors style="margin-top:4px"></div>`;
    const editor = createPlanEditor({
      levels: base.levels,
      templates: [],
      showTemplateSelect: false,
      getTrade: () => ({}),
    });
    form.querySelector("[data-plan-host]").appendChild(editor.element);
    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => entry.close("cancel") }));
    const saveBtn = h("button", { type: "button", class: "btn btn-primary", text: isNew ? "Create plan" : "Save plan", onclick: () => form.requestSubmit() });
    footer.appendChild(saveBtn);
    const entry = openModal({
      title: isNew ? "New Exit Plan" : "Edit Exit Plan",
      size: "modal-md",
      body: form,
      footer,
      focus: '[name="name"]',
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = form.querySelector('[name="name"]').value.trim();
      const levels = editor.getLevels();
      const check = A.validateExitPlan(levels);
      const errEl = form.querySelector("[data-plan-errors]");
      errEl.innerHTML = "";
      const issues = [];
      if (!name) issues.push("Plan name is required.");
      check.errors.forEach((e) => issues.push(e.message));
      if (issues.length) {
        errEl.innerHTML = issues.map((m) => `<div class="field-error">${esc(m)}</div>`).join("");
        return;
      }
      saveBtn.disabled = true;
      try {
        await H.saveTemplate({
          id: base.id,
          name,
          levels,
          createdAt: base.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        entry.close("save");
        toast(isNew ? "Exit Plan created." : "Exit Plan saved.", { type: "success" });
        if (onSaved) onSaved();
      } catch (err) {
        saveBtn.disabled = false;
        toast(err && err.message ? err.message : "Could not save plan.", { type: "error" });
      }
    });
  }

  function parseList(text) {
    return Array.from(new Set(String(text || "").split(",").map((s) => s.trim()).filter(Boolean)));
  }

  function parseNumberList(text) {
    return Array.from(new Set(String(text || "").split(",").map((s) => A.toNum(s)).filter((n) => n !== null && n > 0))).sort((a, b) => a - b);
  }

  function openSettingsModal() {
    const s = model.settings;
    const form = h("form", { class: "trade-form settings-form", novalidate: "novalidate" });
    const decimals = A.instrumentList(s).map((name) => `<label class="inline-setting"><span>${esc(name)}</span><input type="number" min="0" max="10" step="1" data-decimals="${esc(name)}" value="${A.instrumentDecimals(name, s)}"></label>`).join("");
    form.innerHTML = `
      <div class="form-section">
        <h3>Display</h3>
        <div class="form-grid">
          <div class="field"><label>Theme</label><select name="theme">${optionsHTML([{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }], s.theme)}</select></div>
          <div class="field"><label>Low sample warning below</label><input type="number" name="lowSampleThreshold" min="1" max="1000" value="${esc(s.lowSampleThreshold)}"></div>
          <div class="field"><label>Breakeven tolerance (R)</label><input type="number" name="breakevenTolerance" step="0.01" min="0" value="${esc(s.breakevenTolerance)}"><span class="hint">Results within ±tolerance count as breakeven.</span></div>
          <div class="field"><label>Backup reminder</label><label class="switch" style="padding-top:5px"><input type="checkbox" name="backupReminder"${s.backupReminder ? " checked" : ""}> Remind me to export</label></div>
        </div>
      </div>
      <div class="form-section">
        <h3>Blind mode</h3>
        <div class="form-grid">
          <div class="field"><label>New trades</label><label class="switch" style="padding-top:5px"><input type="checkbox" name="blindMode"${s.blindMode ? " checked" : ""}> Capture entry data only</label></div>
          <div class="field"><label>While blind</label><label class="switch" style="padding-top:5px"><input type="checkbox" name="blindHideResults"${s.blindHideResults ? " checked" : ""}> Hide results, dashboard and curves</label></div>
        </div>
      </div>
      <div class="form-section">
        <h3>Time</h3>
        <div class="form-grid">
          <div class="field"><label>Market time zone</label><input type="text" name="marketTimeZone" value="${esc(s.marketTimeZone || "")}" placeholder="e.g. America/New_York"><span class="hint">Chart times are read in this zone. Used only for session suggestions.</span></div>
          <div class="field"><label>Session detection</label><label class="switch" style="padding-top:5px"><input type="checkbox" name="autoSession"${s.autoSession ? " checked" : ""}> Auto-select session from time</label></div>
        </div>
      </div>
      <div class="form-section">
        <h3>Thresholds</h3>
        <div class="form-grid">
          <div class="field"><label>Target-hit thresholds (R)</label><input type="text" name="thresholds" value="${esc(s.thresholds.join(", "))}" placeholder="1, 2, 3, 4, 6, 9"></div>
          <div class="field"><label>MFE boundaries (R)</label><input type="text" name="mfeBoundaries" value="${esc(s.mfeBoundaries.join(", "))}" placeholder="1, 3, 6, 9"></div>
          <div class="field"><label>MAE boundaries (R)</label><input type="text" name="maeBoundaries" value="${esc(s.maeBoundaries.join(", "))}" placeholder="0.25, 0.5, 0.75, 1"></div>
        </div>
      </div>
      <div class="form-section">
        <h3>Custom values</h3>
        <div class="form-grid">
          <div class="field"><label>Instruments</label><div class="tag-editor" data-tag-editor="customInstruments"></div></div>
          <div class="field"><label>Sessions</label><div class="tag-editor" data-tag-editor="customSessions"></div></div>
          <div class="field span-4"><label>Setups</label><div class="tag-editor tag-editor-wide" data-tag-editor="customSetups"></div></div>
        </div>
      </div>
      <div class="form-section">
        <h3>Price decimals</h3>
        <div class="decimals-grid">${decimals}</div>
      </div>
      <div class="form-section">
        <h3>Screenshots (ImgBB)</h3>
        <div class="form-grid">
          <div class="field span-4">
            <label>ImgBB API Key</label>
            <input type="password" name="imgbbApiKey" value="${esc(s.imgbbApiKey || window.ICT_CONFIG?.IMGBB_API_KEY || "")}" placeholder="Paste your ImgBB API key">
            <span class="hint">Used for automatic screenshot uploads (HTF & LTF charts).</span>
          </div>
        </div>
      </div>
      <div class="form-section">
        <h3>Strategy rules</h3>
        <div class="field"><textarea name="strategyRules" rows="4" placeholder="Your entry checklist, risk rules, invalidation criteria…">${esc(s.strategyRules || "")}</textarea></div>
      </div>`;

    // --- Tag editors for custom values ---
    // Only manages user-added custom items. Built-ins are not shown or restored.
    const tagState = {
      customInstruments: (s.customInstruments || []).slice(),
      customSetups: (s.customSetups || []).slice(),
      customSessions: (s.customSessions || []).slice(),
    };

    function renderTagEditor(key) {
      const host = form.querySelector('[data-tag-editor="' + key + '"]');
      if (!host) return;
      const items = tagState[key];
      host.innerHTML = "";
      const tags = h("div", { class: "tag-list" });

      items.forEach((val, idx) => {
        const tag = h("span", { class: "tag-item tag-custom" });
        tag.appendChild(h("span", { text: val }));
        const btn = h("button", { type: "button", class: "tag-remove", title: "Remove", text: "×" });
        btn.addEventListener("click", () => {
          items.splice(idx, 1);
          renderTagEditor(key);
        });
        tag.appendChild(btn);
        tags.appendChild(tag);
      });

      const input = h("input", { type: "text", class: "tag-input", placeholder: "Type name, press Enter to add…" });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === ",") {
          event.preventDefault();
          const val = input.value.trim().replace(/,$/, "");
          if (val && !items.includes(val)) {
            items.push(val);
            renderTagEditor(key);
          } else {
            input.value = "";
          }
        } else if (event.key === "Backspace" && !input.value && items.length) {
          items.pop();
          renderTagEditor(key);
        }
      });
      input.addEventListener("blur", () => {
        const val = input.value.trim().replace(/,$/, "");
        if (val && !items.includes(val)) {
          items.push(val);
          renderTagEditor(key);
        }
      });

      host.appendChild(tags);
      host.appendChild(input);
    }

    ["customInstruments", "customSetups", "customSessions"].forEach(renderTagEditor);

    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => entry.close("cancel") }));
    const saveBtn = h("button", { type: "button", class: "btn btn-primary", text: "Save settings", onclick: () => form.requestSubmit() });
    footer.appendChild(saveBtn);
    const entry = openModal({
      title: "Settings",
      subtitle: "Stored locally in this browser.",
      size: "modal-md",
      body: form,
      footer,
      focus: 'select[name="theme"]',
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const get = (name) => form.querySelector('[name="' + name + '"]');
      const thresholds = parseNumberList(get("thresholds").value);
      const mfeBoundaries = parseNumberList(get("mfeBoundaries").value);
      const maeBoundaries = parseNumberList(get("maeBoundaries").value);
      if (!thresholds.length) {
        toast("Enter at least one target threshold.", { type: "error" });
        get("thresholds").focus();
        return;
      }
      const instrumentDecimals = Object.assign({}, s.instrumentDecimals);
      form.querySelectorAll("[data-decimals]").forEach((input) => {
        const val = parseInt(input.value, 10);
        instrumentDecimals[input.dataset.decimals] = Number.isFinite(val) ? Math.max(0, Math.min(10, val)) : 2;
      });
      const next = Object.assign({}, s, {
        theme: get("theme").value,
        lowSampleThreshold: Math.max(1, parseInt(get("lowSampleThreshold").value, 10) || 30),
        breakevenTolerance: Math.max(0, A.toNum(get("breakevenTolerance").value) || 0),
        backupReminder: get("backupReminder").checked,
        blindMode: get("blindMode").checked,
        blindHideResults: get("blindHideResults").checked,
        marketTimeZone: get("marketTimeZone").value.trim(),
        autoSession: get("autoSession").checked,
        thresholds,
        mfeBoundaries,
        maeBoundaries,
        customInstruments: tagState.customInstruments.slice(),
        customSetups: tagState.customSetups.slice(),
        customSessions: tagState.customSessions.slice(),
        instrumentDecimals,
        imgbbApiKey: get("imgbbApiKey") ? get("imgbbApiKey").value.trim() : (s.imgbbApiKey || ""),
        strategyRules: get("strategyRules").value,
      });

      const imgbbApiKey = get("imgbbApiKey") ? get("imgbbApiKey").value.trim() : "";
      if (window.ICT_CONFIG && imgbbApiKey) {
        window.ICT_CONFIG.update({ IMGBB_API_KEY: imgbbApiKey });
      }

      saveBtn.disabled = true;
      try {
        await H.saveSettings(next);
        entry.close("save");
        toast("Settings saved.", { type: "success" });
      } catch (err) {
        saveBtn.disabled = false;
        toast(err && err.message ? err.message : "Could not save settings.", { type: "error" });
      }
    });
  }

  function openAuthModal(defaultTab = "signin") {
    let activeTab = defaultTab; // "signin" | "signup"
    const form = h("form", { class: "trade-form auth-form", novalidate: "novalidate" });

    function renderAuthContent() {
      form.innerHTML = `
        <div class="auth-modal-tabs">
          <button type="button" class="auth-modal-tab ${activeTab === "signin" ? "active" : ""}" data-tab="signin">Sign In</button>
          <button type="button" class="auth-modal-tab ${activeTab === "signup" ? "active" : ""}" data-tab="signup">Sign Up</button>
        </div>
        <div id="auth-status-container"></div>
        <div class="form-grid" style="grid-template-columns: 1fr; gap: var(--space-3);">
          <div class="field">
            <label>Email Address</label>
            <input type="email" name="email" required placeholder="trader@example.com" autocomplete="email">
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" name="password" required placeholder="••••••••" autocomplete="${activeTab === "signup" ? "new-password" : "current-password"}">
          </div>
        </div>
      `;

      form.querySelectorAll(".auth-modal-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeTab = btn.dataset.tab;
          renderAuthContent();
          submitBtn.textContent = activeTab === "signup" ? "Create Account" : "Sign In";
        });
      });
    }

    renderAuthContent();

    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => entry.close("cancel") }));
    const submitBtn = h("button", { type: "button", class: "btn btn-primary", text: activeTab === "signup" ? "Create Account" : "Sign In", onclick: () => form.requestSubmit() });
    footer.appendChild(submitBtn);

    const entry = openModal({
      title: activeTab === "signup" ? "Create Account" : "Sign In",
      subtitle: "Secure cloud access to your backtesting journal.",
      size: "modal-sm",
      body: form,
      footer,
      focus: 'input[name="email"]',
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const statusEl = form.querySelector("#auth-status-container");
      const email = form.querySelector('input[name="email"]').value.trim();
      const password = form.querySelector('input[name="password"]').value;

      if (!email || !password) {
        if (statusEl) {
          statusEl.innerHTML = `<div class="auth-status-msg error">Please enter both email and password.</div>`;
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = activeTab === "signup" ? "Creating Account…" : "Signing In…";

      try {
        if (activeTab === "signup") {
          await H.authSignUp(email, password);
          toast("Account created! Check your email to confirm or sign in.", { type: "success" });
        } else {
          await H.authSignIn(email, password);
          toast(`Signed in successfully as ${email}`, { type: "success" });
        }
        entry.close("success");
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = activeTab === "signup" ? "Create Account" : "Sign In";
        const msg = err && err.message ? err.message : "Authentication error.";
        if (statusEl) {
          statusEl.innerHTML = `<div class="auth-status-msg error">${esc(msg)}</div>`;
        } else {
          toast(msg, { type: "error" });
        }
      }
    });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return (unit === 0 ? value : value.toFixed(1)) + " " + units[unit];
  }

  function openDataModal() {
    const body = h("div", { class: "data-modal" });
    body.innerHTML = `<div class="data-section">
        <h3>Backup</h3>
        <p class="muted">Everything is stored in this browser. Export a JSON backup before clearing data or switching devices.</p>
        <div class="inline-actions">
          <button type="button" class="btn btn-primary btn-small" data-data-action="export-json">Export JSON backup</button>
          <button type="button" class="btn btn-ghost btn-small" data-data-action="export-csv">Export trades CSV</button>
          <button type="button" class="btn btn-ghost btn-small" data-data-action="import">Import JSON…</button>
        </div>
      </div>
      <div class="data-section">
        <h3>Demo data</h3>
        <p class="muted">Demo trades are flagged and can be removed at any time without touching your own journal.</p>
        <div class="inline-actions">
          <button type="button" class="btn btn-ghost btn-small" data-data-action="demo-100">Load 100 demo trades</button>
          <button type="button" class="btn btn-ghost btn-small" data-data-action="demo-1000">Load 1,000 demo trades</button>
          <button type="button" class="btn btn-ghost btn-small danger" data-data-action="clear-demo">Clear demo trades</button>
        </div>
      </div>
      <div class="data-section">
        <h3>Storage</h3>
        <div class="data-stats" data-data-stats><span class="muted">Calculating…</span></div>
      </div>
      <div class="data-section danger-zone">
        <h3>Danger zone</h3>
        <p class="muted">Clear every trade and screenshot. Exit Plans and configured settings stay untouched. This cannot be undone.</p>
        <button type="button" class="btn btn-danger btn-small" data-data-action="clear-all">Clear trade data</button>
      </div>`;

    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Close", onclick: () => entry.close("close") }));
    const entry = openModal({
      title: "Import / Export",
      subtitle: "JSON is the full backup format; CSV is read-only for spreadsheets.",
      size: "modal-md",
      body,
      footer,
    });

    Promise.all([
      Promise.resolve(H.counts ? H.counts() : null).catch(() => null),
      Promise.resolve(H.storageEstimate ? H.storageEstimate() : null).catch(() => null),
    ]).then(([counts, estimate]) => {
      const stats = body.querySelector("[data-data-stats]");
      if (!stats) return;
      const c = counts || { trades: model.allTrades.length, templates: model.templates.length, screenshots: 0 };
      const demo = model.allTrades.filter((t) => t.isDemo).length;
      stats.innerHTML = `<span><b>${c.trades || 0}</b> trades${demo ? ` <span class="faint">(${demo} demo)</span>` : ""}</span>
        <span><b>${c.templates || 0}</b> Exit Plans</span>
        <span><b>${c.screenshots || 0}</b> screenshots</span>
        <span><b>${c.missedTrades !== undefined ? c.missedTrades : (model.missedTrades ? model.missedTrades.length : 0)}</b> missed trades</span>
        ${estimate && estimate.usage !== undefined ? `<span><b>${formatBytes(estimate.usage)}</b> used${estimate.quota ? ` of ${formatBytes(estimate.quota)}` : ""}</span>` : ""}`;
    });

    body.addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-data-action]");
      if (!btn) return;
      const action = btn.dataset.dataAction;
      if (action === "export-json") {
        try { await H.exportJSON(); toast("Backup exported.", { type: "success" }); } catch (err) { toast(err.message || "Export failed.", { type: "error" }); }
      } else if (action === "export-csv") {
        try { await H.exportCSV(); toast("CSV exported.", { type: "success" }); } catch (err) { toast(err.message || "Export failed.", { type: "error" }); }
      } else if (action === "import") {
        byId("import-file").click();
      } else if (action === "demo-100" || action === "demo-1000") {
        const count = action === "demo-1000" ? 1000 : 100;
        if (model.allTrades.length) {
          const ok = await confirm({ title: "Load demo data?", message: `Add ${count} clearly-marked demo trades to the journal?`, confirmLabel: "Load demo" });
          if (!ok) return;
        }
        entry.close("demo");
        await H.loadDemo(count);
        toast(count + " demo trades loaded.", { type: "success" });
      } else if (action === "clear-demo") {
        const demo = model.allTrades.filter((t) => t.isDemo).length;
        if (!demo) {
          toast("No demo trades to clear.", { type: "info" });
          return;
        }
        const ok = await confirm({ title: "Clear demo data?", message: `Remove all ${demo} demo trades and their screenshots. Your own trades stay untouched.`, confirmLabel: "Clear demo", danger: true });
        if (!ok) return;
        entry.close("clear-demo");
        await H.clearDemo();
        toast("Demo data cleared.", { type: "success" });
      } else if (action === "clear-all") {
        const ok = await confirm({
          title: "Clear trade data?",
          message: "Every trade and screenshot will be deleted. Exit Plans and configured settings stay untouched. Export a backup first if you need it.",
          confirmLabel: "Delete everything",
          danger: true,
        });
        if (!ok) return;
        const typed = await prompt({ title: "Type DELETE to confirm", label: 'Type "DELETE"', placeholder: "DELETE", confirmLabel: "Clear all" });
        if (!typed || typed.toUpperCase() !== "DELETE") {
          if (typed !== null) toast("Confirmation did not match. Nothing was deleted.", { type: "error" });
          return;
        }
        entry.close("clear-all");
        await H.clearAll();
        toast("Trade data cleared.", { type: "success" });
      }
    });
  }

  function validateImportPayload(payload) {
    const errors = [];
    const warnings = [];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { valid: false, errors: ["The file is not a JSON object."], warnings, counts: null };
    }
    if (payload.formatVersion !== 1) errors.push("Unsupported formatVersion: expected 1.");
    const arrays = ["trades", "templates", "screenshots"];
    arrays.forEach((key) => {
      if (payload[key] !== undefined && !Array.isArray(payload[key])) errors.push(`"${key}" must be an array.`);
    });
    if (payload.settings !== undefined && (typeof payload.settings !== "object" || Array.isArray(payload.settings))) {
      errors.push('"settings" must be an object.');
    }
    const trades = Array.isArray(payload.trades) ? payload.trades : [];
    const templates = Array.isArray(payload.templates) ? payload.templates : [];
    const screenshots = Array.isArray(payload.screenshots) ? payload.screenshots : [];
    if (!Array.isArray(payload.trades)) errors.push("The backup has no trades array.");
    const tradeIds = new Set();
    trades.forEach((trade, index) => {
      const label = `Trade ${index + 1}` + (trade && trade.id ? ` (${trade.id})` : "");
      if (!trade || typeof trade !== "object") {
        errors.push(label + ": not an object.");
        return;
      }
      if (!trade.id || typeof trade.id !== "string") errors.push(label + ": missing string id.");
      else if (tradeIds.has(trade.id)) errors.push(label + ": duplicate id within the file.");
      else tradeIds.add(trade.id);
      if (!trade.date) errors.push(label + ": missing date.");
      if (!trade.instrument) errors.push(label + ": missing instrument.");
      const check = A.validateTrade(trade);
      check.errors.slice(0, 4).forEach((issue) => errors.push(label + ": " + issue.message));
    });
    const templateIds = new Set();
    templates.forEach((tpl, index) => {
      const label = `Exit Plan ${index + 1}` + (tpl && tpl.name ? ` (${tpl.name})` : "");
      if (!tpl || typeof tpl !== "object" || !tpl.id || !tpl.name) {
        errors.push(label + ": needs id and name.");
        return;
      }
      if (templateIds.has(tpl.id)) errors.push(label + ": duplicate id within the file.");
      templateIds.add(tpl.id);
      A.validateExitPlan(tpl.levels).errors.slice(0, 3).forEach((issue) => errors.push(label + ": " + issue.message));
    });
    screenshots.forEach((shot, index) => {
      if (!shot || typeof shot !== "object" || !shot.id || !shot.tradeId || (typeof shot.dataUrl !== "string" && typeof shot.url !== "string")) {
        errors.push(`Screenshot ${index + 1}: needs id, tradeId and either a dataUrl or url.`);
      } else if (!tradeIds.has(shot.tradeId)) {
        warnings.push(`Screenshot ${index + 1} references a trade not present in the file.`);
      }
    });
    if (payload.settings === undefined) warnings.push("The backup has no settings; your current settings will stay in place.");
    if (!trades.length) warnings.push("The backup contains no trades.");
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      counts: {
        trades: trades.length,
        templates: templates.length,
        screenshots: screenshots.length,
        settings: payload.settings && typeof payload.settings === "object" ? Object.keys(payload.settings).length : 0,
        missedTrades: Array.isArray(payload.missedTrades) ? payload.missedTrades.length : 0,
      },
    };
  }

  function showImportErrors(fileName, errors) {
    const body = h("div");
    body.appendChild(h("p", { text: `"${fileName}" can't be imported because validation failed. Nothing was changed.` }));
    const list = h("ul", { class: "confirm-list" });
    errors.slice(0, 60).forEach((message) => list.appendChild(h("li", { text: message })));
    if (errors.length > 60) list.appendChild(h("li", { class: "muted", text: `…and ${errors.length - 60} more.` }));
    body.appendChild(list);
    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-primary", text: "Close", onclick: () => entry.close("close") }));
    const entry = openModal({ title: "Import failed", size: "modal-md", body, footer });
  }

  function openImportReview(payload, fileName, validation) {
    const existingIds = new Set(model.allTrades.map((t) => String(t.id)));
    const collisions = (payload.trades || []).filter((t) => existingIds.has(String(t.id))).length;
    const counts = validation.counts;
    const body = h("div");
    body.innerHTML = `<div class="import-summary">
        <div><span>File</span><b>${esc(fileName)}</b></div>
        <div><span>Exported</span><b>${esc(payload.exportedAt ? String(payload.exportedAt).replace("T", " ").slice(0, 16) : "—")}</b></div>
        <div><span>Source</span><b>${esc(payload.app || "ICT Backtest Journal")}</b></div>
        <div><span>Trades</span><b>${counts.trades}</b></div>
        <div><span>Exit Plans</span><b>${counts.templates}</b></div>
        <div><span>Screenshots</span><b>${counts.screenshots}</b></div>
        <div><span>Missed Trades</span><b>${counts.missedTrades || 0}</b></div>
        <div><span>Setting keys</span><b>${counts.settings}</b></div>
      </div>
      ${validation.warnings.length ? `<div class="form-notice warn">${validation.warnings.map(esc).join("<br>")}</div>` : ""}
      ${collisions ? `<div class="form-notice info"><b>${collisions}</b> trade id(s) already exist. Merge can update them only if you confirm below.</div>
        <label class="switch"><input type="checkbox" name="updateExisting"> Update trades with existing ids (explicit confirmation)</label>` : ""}
      <p class="muted" style="margin-top:12px">Replace wipes current data first. Merge adds new records and keeps what you already have.</p>`;

    const footer = h("div", { class: "modal-foot" });
    const cancel = h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => entry.close("cancel") });
    const replace = h("button", { type: "button", class: "btn btn-ghost danger", text: "Replace all" });
    const merge = h("button", { type: "button", class: "btn btn-primary", text: "Merge" });
    footer.appendChild(cancel);
    footer.appendChild(replace);
    footer.appendChild(merge);
    const entry = openModal({
      title: "Review import",
      subtitle: "Nothing has been written yet.",
      size: "modal-md",
      body,
      footer,
    });

    merge.addEventListener("click", async () => {
      const updateBox = body.querySelector('[name="updateExisting"]');
      const updateExisting = !!(updateBox && updateBox.checked);
      merge.disabled = true;
      try {
        const result = await H.mergeImport(payload, { updateExisting });
        entry.close("merge");
        const added = result && result.addedTrades !== undefined ? result.addedTrades : counts.trades;
        const updated = result && result.updatedTrades !== undefined ? result.updatedTrades : 0;
        toast(`Import complete: ${added} added, ${updated} updated.`, { type: "success" });
        await H.reload();
      } catch (err) {
        merge.disabled = false;
        toast(err && err.message ? err.message : "Import failed.", { type: "error" });
      }
    });

    replace.addEventListener("click", async () => {
      const ok = await confirm({
        title: "Replace all data?",
        message: "Your current trades, Exit Plans, screenshots, and settings will be deleted and replaced by this file.",
        confirmLabel: "Replace everything",
        danger: true,
      });
      if (!ok) return;
      replace.disabled = true;
      try {
        await H.replaceImport(payload);
        entry.close("replace");
        toast("Data replaced from backup.", { type: "success" });
        await H.reload();
      } catch (err) {
        replace.disabled = false;
        toast(err && err.message ? err.message : "Import failed.", { type: "error" });
      }
    });
  }

  async function handleImportFile(file) {
    if (!file) return;
    if (file.size > 250 * 1024 * 1024) {
      toast("That file is larger than 250 MB.", { type: "error" });
      return;
    }
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch (err) {
      showImportErrors(file.name, ["The file is not valid JSON."]);
      return;
    }
    const validation = validateImportPayload(payload);
    if (!validation.valid) {
      showImportErrors(file.name, validation.errors);
      return;
    }
    openImportReview(payload, file.name, validation);
  }

  const INLINE_SELECTS = {
    session: () => A.sessionList(model.settings),
    killzone: () => A.DEFAULTS.killzones,
    instrument: () => A.instrumentList(model.settings),
    direction: () => A.DEFAULTS.directions,
    setup: () => A.setupList(model.settings),
    setupQuality: () => A.DEFAULTS.qualities,
    htfBias: () => A.DEFAULTS.htfBiases,
    htfTimeframe: () => A.DEFAULTS.timeframes,
    entryTimeframe: () => A.DEFAULTS.entryTimeframes,
    exitReason: () => A.DEFAULTS.exitReasons,
    pathComplete: () => [{ value: "true", label: "Yes" }, { value: "false", label: "No" }],
  };

  function inlineRawValue(trade, field) {
    if (field === "wickSl" || field === "wickRr") return trade.wickRr === null || trade.wickRr === undefined ? "" : trade.wickRr;
    if (field === "bodySl" || field === "bodyRr") return trade.bodyRr === null || trade.bodyRr === undefined ? "" : trade.bodyRr;
    if (field === "spcSl" || field === "spcRr") return trade.spcSl === null || trade.spcSl === undefined ? "" : trade.spcSl;
    if (field === "mfe" || field === "mae") return trade.tradePath && trade.tradePath[field] !== null && trade.tradePath[field] !== undefined ? trade.tradePath[field] : "";
    if (field === "finalR") return A.toNum(trade.finalROverride) === null ? "" : trade.finalROverride;
    if (field === "pathComplete") return trade.tradePath && trade.tradePath.pathComplete ? "true" : "false";
    if (field === "waypoints") return trade.tradePath && Array.isArray(trade.tradePath.waypoints) ? trade.tradePath.waypoints.join(", ") : "";
    return trade[field] === null || trade[field] === undefined ? "" : trade[field];
  }

  function beginInlineEdit(td, trade, field) {
    if (!trade) return;
    const original = td.innerHTML;
    const current = inlineRawValue(trade, field);
    let control;
    if (INLINE_SELECTS[field]) {
      control = h("select", { class: "inline-editor" });
      const items = INLINE_SELECTS[field]();
      const list = items.map((item) => (typeof item === "string" ? { value: item, label: item } : item));
      control.innerHTML = optionsHTML(list, current, "—");
      if (field === "pathComplete") control.innerHTML = optionsHTML(list, current, null);
    } else if (field === "notes") {
      control = h("textarea", { class: "inline-editor", rows: "3", value: String(current) });
    } else if (field === "date") {
      control = h("input", { type: "date", class: "inline-editor", value: String(current) });
    } else if (["entry", "stopLoss", "riskR", "mfe", "mae", "remainderExitR", "finalR"].includes(field)) {
      control = h("input", { type: "number", step: field === "riskR" ? "0.01" : "any", class: "inline-editor", value: String(current) });
    } else {
      control = h("input", { type: "text", class: "inline-editor", value: String(current) });
    }
    td.classList.add("editing");
    td.innerHTML = "";
    td.appendChild(control);
    control.focus();
    if (control.select) control.select();

    let finished = false;
    function cancel() {
      if (finished) return;
      finished = true;
      td.classList.remove("editing");
      td.innerHTML = original;
    }
    async function commit() {
      if (finished) return;
      finished = true;
      const raw = control.value;
      const patch = {};
      if (field === "mfe" || field === "mae" || field === "pathComplete" || field === "waypoints") {
        const tp = Object.assign({}, trade.tradePath || {});
        if (field === "pathComplete") tp.pathComplete = raw === "true";
        else if (field === "waypoints") {
          tp.waypoints = raw.trim() ? raw.split(",").map((s) => A.toNum(s)).filter((n) => n !== null) : null;
        } else {
          if (raw.trim() === "") tp[field] = null;
          else {
            const num = A.toNum(raw);
            if (num === null || num < 0) {
              toast(field.toUpperCase() + " must be a non-negative number.", { type: "error" });
              cancel();
              return;
            }
            tp[field] = num;
          }
        }
        patch.tradePath = tp;
      } else if (field === "finalR") {
        if (raw.trim() === "") patch.finalROverride = null;
        else {
          const num = A.toNum(raw);
          if (num === null) {
            toast("Final R must be a number or empty.", { type: "error" });
            cancel();
            return;
          }
          patch.finalROverride = num;
        }
      } else if (["entry", "stopLoss", "riskR", "remainderExitR"].includes(field)) {
        if (raw.trim() === "") {
          if (field === "remainderExitR") patch[field] = null;
          else {
            toast(field === "riskR" ? "Risk is required." : field + " is required.", { type: "error" });
            cancel();
            return;
          }
        } else {
          const num = A.toNum(raw);
          if (num === null) {
            toast("Enter a valid number.", { type: "error" });
            cancel();
            return;
          }
          patch[field] = num;
        }
      } else if (field === "wickSl" || field === "wickRr") {
        patch.wickRr = raw.trim() ? (A.toNum(raw) !== null ? A.toNum(raw) : raw.trim()) : null;
      } else if (field === "bodySl" || field === "bodyRr") {
        patch.bodyRr = raw.trim() ? (A.toNum(raw) !== null ? A.toNum(raw) : raw.trim()) : null;
      } else if (field === "spcSl" || field === "spcRr") {
        patch.spcSl = raw.trim() ? (A.toNum(raw) !== null ? A.toNum(raw) : raw.trim()) : null;
      } else {
        patch[field] = raw;
      }
      try {
        const result = await H.updateTrade(trade.id, patch);
        if (result && result.ok === false) {
          toast(result.errors && result.errors[0] ? result.errors[0] : "That change is not valid.", { type: "error" });
          await H.reload();
          return;
        }
        await H.reload();
      } catch (err) {
        toast(err && err.message ? err.message : "Could not update trade.", { type: "error" });
        await H.reload();
      }
    }

    control.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      } else if (event.key === "Enter" && field !== "notes") {
        event.preventDefault();
        commit();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        commit();
      }
    });
    control.addEventListener("blur", () => {
      setTimeout(() => {
        if (!finished) commit();
      }, 80);
    });
    if (control.tagName === "SELECT") {
      control.addEventListener("change", () => commit());
    }
  }

  function openTradePlanEditor(trade) {
    if (!trade) return;
    const editor = createPlanEditor({
      levels: trade.exitPlan,
      templateId: trade.exitPlanTemplateId,
      templates: model.templates,
      trade,
      getTrade: () => trade,
      onSaveTemplate: async (name, levels) => {
        await H.saveTemplate({ id: genId("tpl"), name, levels, createdAt: new Date().toISOString() });
        toast("Exit Plan template saved.", { type: "success" });
      },
    });
    const body = h("div");
    body.appendChild(h("div", { class: "form-notice info", text: "Editing the plan changes how Final R and Levels Hit are derived for this trade. Stored MFE/remainder values are kept." }));
    body.appendChild(editor.element);
    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => entry.close("cancel") }));
    const saveBtn = h("button", { type: "button", class: "btn btn-primary", text: "Save plan" });
    footer.appendChild(saveBtn);
    const entry = openModal({
      title: "Exit Plan · Trade #" + (trade.tradeNumber || "—"),
      size: "modal-md",
      body,
      footer,
    });
    saveBtn.addEventListener("click", async () => {
      const levels = editor.getLevels();
      const check = A.validateExitPlan(levels);
      if (!check.valid) {
        toast(check.errors[0].message, { type: "error" });
        return;
      }
      const templateId = editor.getTemplateId();
      const tpl = templateId ? model.templates.find((t) => t.id === templateId) : null;
      saveBtn.disabled = true;
      try {
        const result = await H.updateTrade(trade.id, {
          exitPlan: levels,
          exitPlanTemplateId: templateId || null,
          exitPlanTemplateName: tpl ? tpl.name : "",
        });
        if (result && result.ok === false) {
          toast(result.errors && result.errors[0] ? result.errors[0] : "Could not save plan.", { type: "error" });
          saveBtn.disabled = false;
          return;
        }
        entry.close("save");
        toast("Exit Plan updated.", { type: "success" });
        await H.reload();
      } catch (err) {
        saveBtn.disabled = false;
        toast(err && err.message ? err.message : "Could not save plan.", { type: "error" });
      }
    });
  }

  function openApplyTemplateModal() {
    if (!selection.size) return;
    const templates = model.templates || [];
    if (!templates.length) {
      toast("Create an Exit Plan first.", { type: "info" });
      openTemplatesModal();
      return;
    }
    const body = h("div");
    const defaultTpl = templates[0];
    body.innerHTML = `<p class="muted">Apply one Exit Plan to <b>${selection.size}</b> selected trade(s). Final R will be re-derived from each stored MFE and remainder.</p>
      <div class="field"><label>Exit Plan</label><select name="template">${optionsHTML(templates.map((t) => ({ value: t.id, label: t.name })), defaultTpl.id)}</select></div>
      <div class="plan-preview" data-apply-preview></div>`;
    const select = body.querySelector('[name="template"]');
    const preview = body.querySelector("[data-apply-preview]");
    function update() {
      const tpl = templates.find((t) => t.id === select.value);
      preview.textContent = tpl ? A.planString(tpl.levels) : "—";
    }
    select.addEventListener("change", update);
    update();
    const footer = h("div", { class: "modal-foot" });
    footer.appendChild(h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => entry.close("cancel") }));
    const applyBtn = h("button", { type: "button", class: "btn btn-primary", text: "Apply to " + selection.size });
    footer.appendChild(applyBtn);
    const entry = openModal({
      title: "Apply Exit Plan",
      size: "modal-sm",
      body,
      footer,
    });
    applyBtn.addEventListener("click", async () => {
      const tpl = templates.find((t) => t.id === select.value);
      if (!tpl) return;
      applyBtn.disabled = true;
      try {
        if (H.applyTemplateToSelection) {
          await H.applyTemplateToSelection(Array.from(selection), tpl.id);
        } else {
          for (const id of Array.from(selection)) {
            await H.updateTrade(id, { exitPlan: tpl.levels.map((l) => ({ ...l })), exitPlanTemplateId: tpl.id, exitPlanTemplateName: tpl.name });
          }
        }
        entry.close("apply");
        toast("Exit Plan applied to " + selection.size + " trade(s).", { type: "success" });
        await H.reload();
      } catch (err) {
        applyBtn.disabled = false;
        toast(err && err.message ? err.message : "Could not apply plan.", { type: "error" });
      }
    });
  }

  /* ==========================================================================
     MISSED TRADES LOGIC, MODAL & LIGHTBOX
     ========================================================================== */

  const cardActiveTf = new Map();

  async function processChartImage(input) {
    if (!input) return null;

    if (typeof input === "string") {
      const str = input.trim();
      if (!str) return null;
      // Convert TradingView snapshot webpage links to direct image URLs
      const tvMatch = str.match(/(?:https?:\/\/)?(?:www\.)?tradingview\.com\/x\/([a-zA-Z0-9]+)/i);
      if (tvMatch) {
        const id = tvMatch[1];
        const c = id.charAt(0).toLowerCase();
        return `https://s3.tradingview.com/snapshots/${c}/${id}.png`;
      }
      return str;
    }

    // Input is a File or Blob -> Compress client-side to JPEG (max 1600px, quality 0.8)
    const compressedDataUrl = await compressImageToDataUrl(input);

    const apiKey = (model && model.settings && model.settings.imgbbApiKey) || (window.ICT_CONFIG && window.ICT_CONFIG.IMGBB_API_KEY);
    if (apiKey) {
      try {
        const comma = compressedDataUrl.indexOf(",");
        const base64 = comma === -1 ? compressedDataUrl : compressedDataUrl.slice(comma + 1);
        const name = (input && input.name) ? input.name : "missed_chart.jpg";
        const uploaded = await uploadToImgBBWithTimeout(base64, name, apiKey, 15000);
        if (uploaded && uploaded.url) {
          return uploaded.url;
        }
      } catch (err) {
        console.warn("ImgBB upload failed or timed out; saving compressed image locally.", err);
      }
    }

    return compressedDataUrl;
  }

  function renderMissedTrades() {
    const section = byId("missed-trades-section");
    if (!section || section.hidden) return;

    // 1. Summary Bar
    const stats = model.missedStats || { total: 0, totalR: 0, topReason: "—", topReasonCount: 0 };
    byId("missed-stat-count").textContent = stats.total;
    const rVal = stats.totalR || 0;
    const rEl = byId("missed-stat-r");
    rEl.textContent = (rVal >= 0 ? "+" : "") + A.formatNumber(rVal, 1) + "R";
    rEl.className = "dash-card-value " + (rVal > 0 ? "pos" : rVal < 0 ? "neg" : "zero");
    byId("missed-stat-reason").textContent = stats.topReason || "—";
    byId("missed-stat-reason-sub").textContent = stats.topReasonCount
      ? `${stats.topReasonCount} trade${stats.topReasonCount === 1 ? "" : "s"} (${Math.round((stats.topReasonCount / (stats.total || 1)) * 100)}%)`
      : "Most frequent reflection";

    // 2. Filter Controls
    const instSelect = byId("missed-filter-instrument");
    const currentInst = model.missedFilters.instrument || "";
    const instruments = A.instrumentList(model.settings);
    instSelect.innerHTML = `<option value="">All instruments</option>` +
      instruments.map((i) => `<option value="${esc(i)}"${currentInst === i ? " selected" : ""}>${esc(i)}</option>`).join("");

    const sessSelect = byId("missed-filter-session");
    const currentSess = model.missedFilters.session || "";
    const sessions = A.sessionList(model.settings);
    sessSelect.innerHTML = `<option value="">All sessions</option>` +
      sessions.map((s) => `<option value="${esc(s)}"${currentSess === s ? " selected" : ""}>${esc(s)}</option>`).join("");

    const searchInput = byId("missed-search");
    if (document.activeElement !== searchInput) {
      searchInput.value = model.missedFilters.search || "";
    }

    // Reason pills
    const reasons = (model.missedReasons && model.missedReasons.length) ? model.missedReasons : A.DEFAULT_MISSED_REASONS;
    const activeReason = model.missedFilters.reason || "All";
    const pillsHost = byId("missed-reason-pills");
    let pillsHTML = `<button type="button" class="chip${activeReason === "All" ? " active" : ""}" data-reason="All">All</button>`;
    pillsHTML += reasons.map((r) =>
      `<button type="button" class="chip${activeReason === r ? " active" : ""}" data-reason="${esc(r)}">
        <span>${esc(r)}</span>
        <span class="chip-del" data-del-filter-reason="${esc(r)}" title="Remove '${esc(r)}' from list">×</span>
      </button>`
    ).join("");
    pillsHTML += `
      <div class="missed-inline-add-reason">
        <input type="text" id="missed-filter-add-input" class="missed-mini-input" placeholder="Add custom reason..." />
        <button type="button" class="btn btn-ghost btn-small" id="btn-save-filter-reason">+ Add Reason</button>
      </div>
    `;
    pillsHost.innerHTML = pillsHTML;

    // 3. Grid & Cards
    const grid = byId("missed-grid");
    const empty = byId("missed-empty");
    const trades = model.filteredMissedTrades || [];

    if (!trades.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      byId("missed-empty-sub").textContent = model.missedTrades.length
        ? "No missed trades match your active filters."
        : "No missed trades recorded yet. Start tracking setups you hesitated on!";
      return;
    }

    empty.hidden = true;
    grid.innerHTML = trades.map((t) => {
      const hasHtf = !!t.htfScreenshot;
      const hasLtf = !!t.ltfScreenshot;
      let activeTf = cardActiveTf.get(t.id);
      if (!activeTf) {
        activeTf = hasHtf ? "HTF" : (hasLtf ? "LTF" : "HTF");
        cardActiveTf.set(t.id, activeTf);
      }
      const currentSrc = activeTf === "HTF" ? t.htfScreenshot : t.ltfScreenshot;
      const fallbackSrc = currentSrc || (activeTf === "HTF" ? t.ltfScreenshot : t.htfScreenshot);

      const shotMarkup = fallbackSrc
        ? `<img src="${esc(fallbackSrc)}" alt="Missed trade ${esc(t.instrument || '')}" loading="lazy" />`
        : `<div class="missed-no-shot"><span class="missed-no-shot-icon">📷</span><span>No chart attached</span></div>`;

      let toggleMarkup = "";
      if (hasHtf && hasLtf) {
        toggleMarkup = `
          <div class="missed-tf-toggle">
            <button type="button" class="missed-tf-btn${activeTf === "HTF" ? " active" : ""}" data-card-tf="HTF" data-trade-id="${esc(t.id)}">HTF</button>
            <button type="button" class="missed-tf-btn${activeTf === "LTF" ? " active" : ""}" data-card-tf="LTF" data-trade-id="${esc(t.id)}">LTF</button>
          </div>
        `;
      } else if (hasHtf) {
        toggleMarkup = `<span class="missed-tf-single">HTF</span>`;
      } else if (hasLtf) {
        toggleMarkup = `<span class="missed-tf-single">LTF</span>`;
      }

      const potR = A.toNum(t.potentialR) || 0;
      const rBadge = `<span class="pill pill-win missed-potential-r">+${A.formatNumber(potR, 1)}R</span>`;
      const isLong = t.direction === "Long";
      const dirBadge = `<span class="pill ${isLong ? "pill-win" : "pill-loss"}">${esc(t.direction || "Long")}</span>`;

      const lesson = String(t.notes || "No reflection recorded.");
      const isLongText = lesson.length > 130;

      return `
        <article class="missed-card" data-missed-id="${esc(t.id)}">
          <div class="missed-card-screen" data-action="lightbox">
            ${shotMarkup}
            ${toggleMarkup}
          </div>
          <div class="missed-card-footer">
            <div class="missed-footer-row1">
              <div class="missed-badges-left">
                <span class="pill">${esc(t.date || "—")}</span>
                <span class="pill">${esc(t.session || "—")}</span>
                <span class="pill">${esc(t.instrument || "—")}</span>
                ${dirBadge}
              </div>
              <div>
                ${rBadge}
              </div>
            </div>
            <div class="missed-footer-row2">
              <div class="missed-lesson-wrap">
                <span class="pill pill-warn missed-reason-badge">${esc(t.reason || "Hesitation")}</span>
                <p class="missed-lesson-text clamp-3">${esc(lesson)}${isLongText ? ' <button type="button" class="missed-expand-btn" data-action="expand">more</button>' : ''}</p>
              </div>
              <div class="missed-card-actions">
                <button type="button" class="icon-btn" data-action="edit" title="Edit missed trade">✎</button>
                <button type="button" class="icon-btn danger" data-action="delete" title="Delete missed trade">×</button>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function openMissedTradeModal(existingTrade) {
    const isNew = !existingTrade;
    const draft = Object.assign({}, existingTrade || {
      date: todayISO(),
      instrument: A.instrumentList(model.settings)[0] || "S&P500",
      session: A.sessionList(model.settings)[0] || "London",
      direction: "Long",
      potentialR: "",
      reason: "Hesitation",
      notes: "",
      htfScreenshot: null,
      ltfScreenshot: null,
    });

    let currentDirection = draft.direction || "Long";
    let selectedReason = draft.reason || "Hesitation";
    let htfUrl = draft.htfScreenshot || null;
    let ltfUrl = draft.ltfScreenshot || null;
    let isUploadingHtf = false;
    let isUploadingLtf = false;
    let activeSlot = !htfUrl ? "htf" : (!ltfUrl ? "ltf" : "htf");

    const body = h("div", { class: "trade-form" });

    const instruments = A.instrumentList(model.settings);
    const sessions = A.sessionList(model.settings);

    function renderTagPicker() {
      const reasons = (model.missedReasons && model.missedReasons.length) ? model.missedReasons : A.DEFAULT_MISSED_REASONS;
      const allReasons = Array.from(new Set([...reasons, selectedReason].filter(Boolean)));
      return allReasons.map((r) =>
        `<button type="button" class="missed-tag-pill${selectedReason === r ? " active" : ""}" data-modal-reason="${esc(r)}">
          <span>${esc(r)}</span>
          <span class="missed-tag-del" data-del-modal-reason="${esc(r)}" title="Remove '${esc(r)}' from list">×</span>
        </button>`
      ).join("");
    }

    function renderDropzone(slot, url, isUploading) {
      if (isUploading) {
        return `
          <div class="missed-dropzone-prompt">
            <span class="missed-dropzone-spinner"></span>
            <b>Processing chart...</b>
            <div class="hint" style="margin-top:4px;">Optimizing image...</div>
          </div>
          <input type="file" accept="image/*" data-file-slot="${slot}" hidden />
        `;
      }
      if (url) {
        return `
          <img src="${esc(url)}" class="missed-dropzone-preview" alt="${slot} chart preview" />
          <div class="missed-dropzone-slot-label" style="position:absolute; top:8px; left:8px; z-index:5; background:rgba(15,23,42,0.85); padding:2px 8px; border-radius:4px; font-size:10px; color:#fff;">${slot.toUpperCase()}</div>
          <button type="button" class="missed-dropzone-remove" data-remove-slot="${slot}" title="Remove screenshot">×</button>
          <input type="file" accept="image/*" data-file-slot="${slot}" hidden />
        `;
      }
      return `
        <div class="missed-dropzone-slot-label">${slot.toUpperCase()} Screenshot</div>
        <div class="missed-dropzone-prompt">
          <b>Drag & drop</b>, click to browse, or paste <b>Ctrl+V</b>
          <div class="hint" style="margin-top:4px;">Accepts chart image files, TradingView links, or URLs</div>
        </div>
        <input type="file" accept="image/*" data-file-slot="${slot}" hidden />
      `;
    }

    body.innerHTML = `
      <div class="form-grid form-grid-4">
        <div class="field">
          <label>Date</label>
          <input type="date" name="date" value="${esc(draft.date || todayISO())}" required />
        </div>
        <div class="field">
          <label>Instrument</label>
          <select name="instrument">
            ${instruments.map((i) => `<option value="${esc(i)}"${(draft.instrument || "") === i ? " selected" : ""}>${esc(i)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Session</label>
          <select name="session">
            ${sessions.map((s) => `<option value="${esc(s)}"${(draft.session || "") === s ? " selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Direction</label>
          <div class="segmented" role="group" aria-label="Trade direction">
            <button type="button" class="seg${currentDirection === "Long" ? " active" : ""}" data-dir="Long">Long</button>
            <button type="button" class="seg${currentDirection === "Short" ? " active" : ""}" data-dir="Short">Short</button>
          </div>
        </div>
      </div>

      <div class="form-grid form-grid-4" style="margin-top:14px;">
        <div class="field">
          <label>Potential R (Theoretical)</label>
          <input type="number" step="0.1" min="0" name="potentialR" value="${draft.potentialR !== undefined && draft.potentialR !== null ? draft.potentialR : ""}" placeholder="e.g. 5.5" required />
          <span class="hint">Theoretical R:R if executed to target</span>
        </div>
        <div class="field span-3">
          <label>Missed Reason</label>
          <div class="missed-tag-picker" id="modal-tag-picker">
            ${renderTagPicker()}
          </div>
          <div style="display:flex; gap:6px;">
            <input type="text" id="modal-custom-reason" placeholder="Add custom reason..." style="font-size:12px; padding:5px 8px; flex:1;" />
            <button type="button" class="btn btn-ghost btn-small" id="btn-add-custom-reason">+ Add Reason</button>
          </div>
        </div>
      </div>

      <div class="field" style="margin-top:14px;">
        <label>Lesson / Reflection ("What stopped me from executing, and how do I fix it?")</label>
        <textarea name="notes" rows="3" placeholder="What stopped me from executing, and how do I fix it?">${esc(draft.notes || "")}</textarea>
      </div>

      <div class="field" style="margin-top:14px;">
        <label>Screenshots (HTF & LTF Charts)</label>
        <div class="missed-dropzone-grid">
          <div class="missed-dropzone" data-dropzone="htf" tabindex="0">
            ${renderDropzone("htf", htfUrl, isUploadingHtf)}
          </div>
          <div class="missed-dropzone" data-dropzone="ltf" tabindex="0">
            ${renderDropzone("ltf", ltfUrl, isUploadingLtf)}
          </div>
        </div>
      </div>
    `;

    // Direction segmented control
    body.querySelectorAll("[data-dir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentDirection = btn.dataset.dir;
        body.querySelectorAll("[data-dir]").forEach((b) => b.classList.toggle("active", b.dataset.dir === currentDirection));
      });
    });

    // Tag pills
    function updateTagsUI() {
      const picker = body.querySelector("#modal-tag-picker");
      if (picker) picker.innerHTML = renderTagPicker();
    }

    body.addEventListener("click", async (e) => {
      const delBtn = e.target.closest("[data-del-modal-reason]");
      if (delBtn) {
        e.stopPropagation();
        e.preventDefault();
        const reasonToDel = delBtn.dataset.delModalReason;
        await H.deleteMissedReason(reasonToDel);
        if (selectedReason === reasonToDel) {
          selectedReason = (model.missedReasons && model.missedReasons[0]) || "Hesitation";
        }
        updateTagsUI();
        return;
      }

      const pill = e.target.closest("[data-modal-reason]");
      if (pill) {
        selectedReason = pill.dataset.modalReason;
        updateTagsUI();
      }
    });

    const customInput = body.querySelector("#modal-custom-reason");
    const addCustomBtn = body.querySelector("#btn-add-custom-reason");
    async function addCustomTag() {
      const val = customInput.value.trim();
      if (val) {
        await H.saveMissedReason(val);
        selectedReason = val;
        customInput.value = "";
        updateTagsUI();
      }
    }
    addCustomBtn.addEventListener("click", addCustomTag);
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addCustomTag();
      }
    });

    // Dropzone management
    function updateDropzoneHighlight() {
      const htfZone = body.querySelector('[data-dropzone="htf"]');
      const ltfZone = body.querySelector('[data-dropzone="ltf"]');
      if (htfZone) htfZone.classList.toggle("selected-slot", activeSlot === "htf");
      if (ltfZone) ltfZone.classList.toggle("selected-slot", activeSlot === "ltf");
    }

    function updateDropzonesUI() {
      const htfZone = body.querySelector('[data-dropzone="htf"]');
      const ltfZone = body.querySelector('[data-dropzone="ltf"]');
      if (htfZone) htfZone.innerHTML = renderDropzone("htf", htfUrl, isUploadingHtf);
      if (ltfZone) ltfZone.innerHTML = renderDropzone("ltf", ltfUrl, isUploadingLtf);
      updateDropzoneHighlight();
      attachDropzoneEvents();
    }

    async function handleFileSlot(slot, fileOrUrl) {
      if (!fileOrUrl) return;
      if (slot === "htf") isUploadingHtf = true;
      else isUploadingLtf = true;
      updateDropzonesUI();

      try {
        const url = await processChartImage(fileOrUrl);
        if (url) {
          if (slot === "htf") htfUrl = url;
          else ltfUrl = url;
        }
      } catch (err) {
        console.error("Chart processing error:", err);
        toast(err.message || "Could not process image.", { type: "error" });
      } finally {
        if (slot === "htf") isUploadingHtf = false;
        else isUploadingLtf = false;
        updateDropzonesUI();
      }
    }

    function attachDropzoneEvents() {
      ["htf", "ltf"].forEach((slot) => {
        const zone = body.querySelector(`[data-dropzone="${slot}"]`);
        if (!zone) return;

        zone.onfocus = () => {
          activeSlot = slot;
          updateDropzoneHighlight();
        };

        zone.onclick = (e) => {
          activeSlot = slot;
          updateDropzoneHighlight();

          if (e.target.closest("[data-remove-slot]")) {
            e.stopPropagation();
            if (slot === "htf") htfUrl = null;
            else ltfUrl = null;
            updateDropzonesUI();
            return;
          }
          const fileInput = zone.querySelector("input[type=file]");
          if (fileInput) fileInput.click();
        };

        const fileInput = zone.querySelector("input[type=file]");
        if (fileInput) {
          fileInput.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) handleFileSlot(slot, file);
          };
        }

        zone.ondragover = (e) => {
          e.preventDefault();
          activeSlot = slot;
          updateDropzoneHighlight();
          zone.classList.add("drag-over");
        };
        zone.ondragleave = () => zone.classList.remove("drag-over");
        zone.ondrop = (e) => {
          e.preventDefault();
          zone.classList.remove("drag-over");
          activeSlot = slot;
          updateDropzoneHighlight();
          const file = e.dataTransfer.files && e.dataTransfer.files[0];
          if (file) {
            handleFileSlot(slot, file);
          } else {
            const text = e.dataTransfer.getData("text");
            if (text && text.trim()) {
              handleFileSlot(slot, text.trim());
            }
          }
        };
      });
    }

    attachDropzoneEvents();
    updateDropzoneHighlight();

    // Global paste within modal
    body.addEventListener("paste", async (e) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
        const items = e.clipboardData && e.clipboardData.items;
        let hasImage = false;
        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.startsWith("image/")) {
              hasImage = true;
              break;
            }
          }
        }
        if (!hasImage && (active.id === "modal-custom-reason" || active.name === "notes" || active.name === "potentialR" || active.name === "date")) {
          return;
        }
      }

      const clipboardData = e.clipboardData || window.clipboardData;
      if (!clipboardData) return;

      let file = null;
      if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          if (clipboardData.files[i].type && clipboardData.files[i].type.startsWith("image/")) {
            file = clipboardData.files[i];
            break;
          }
        }
      }
      if (!file && clipboardData.items) {
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.type && item.type.startsWith("image/")) {
            file = item.getAsFile();
            break;
          }
        }
      }

      const text = (clipboardData.getData("text") || "").trim();
      const isUrl = text && (
        /^https?:\/\/.+/i.test(text) ||
        text.includes("tradingview.com/x/") ||
        text.startsWith("data:image/")
      );

      if (file || isUrl) {
        e.preventDefault();
        e.stopPropagation();

        let targetSlot = activeSlot;
        const dropzoneEl = e.target && e.target.closest && e.target.closest("[data-dropzone]");
        if (dropzoneEl && dropzoneEl.dataset.dropzone) {
          targetSlot = dropzoneEl.dataset.dropzone;
        } else if (!targetSlot) {
          targetSlot = !htfUrl ? "htf" : (!ltfUrl ? "ltf" : "htf");
        }

        activeSlot = targetSlot;
        updateDropzoneHighlight();
        await handleFileSlot(targetSlot, file || text);
        toast(`Chart attached to ${targetSlot.toUpperCase()}`, { type: "success" });
      }
    });

    const footer = h("div", { class: "modal-foot" });
    const cancelBtn = h("button", { type: "button", class: "btn btn-ghost", text: "Cancel", onclick: () => entry.close("cancel") });
    const saveBtn = h("button", { type: "button", class: "btn btn-primary", text: isNew ? "Log Missed Trade" : "Save Changes" });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    const entry = openModal({
      title: isNew ? "Log Missed Trade" : "Edit Missed Trade",
      subtitle: "Capture chart context, psychological reasons, and lessons.",
      size: "modal-md",
      body,
      footer,
    });

    saveBtn.addEventListener("click", async () => {
      if (isUploadingHtf || isUploadingLtf) {
        toast("Please wait for chart processing to finish before saving.", { type: "warn" });
        return;
      }
      const formEl = body;
      const date = formEl.querySelector('[name="date"]').value;
      const instrument = formEl.querySelector('[name="instrument"]').value;
      const session = formEl.querySelector('[name="session"]').value;
      const potentialR = A.toNum(formEl.querySelector('[name="potentialR"]').value);
      const notes = formEl.querySelector('[name="notes"]').value;

      const tradeData = {
        id: draft.id,
        date,
        instrument,
        session,
        direction: currentDirection,
        potentialR,
        reason: selectedReason || "Hesitation",
        notes,
        htfScreenshot: htfUrl,
        ltfScreenshot: ltfUrl,
        createdAt: draft.createdAt,
      };

      const result = await H.saveMissedTrade(tradeData);
      if (!result.ok) {
        toast((result.errors && result.errors[0]) || "Could not save missed trade.", { type: "error" });
        return;
      }
      entry.close("save");
      toast(isNew ? "Missed trade logged." : "Missed trade updated.", { type: "success" });
    });
  }

  function openMissedLightbox(trade, initialTf) {
    const hasHtf = !!trade.htfScreenshot;
    const hasLtf = !!trade.ltfScreenshot;
    let currentTf = initialTf || (hasHtf ? "HTF" : "LTF");
    if (currentTf === "HTF" && !hasHtf && hasLtf) currentTf = "LTF";
    if (currentTf === "LTF" && !hasLtf && hasHtf) currentTf = "HTF";

    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const overlay = h("div", { class: "missed-lightbox-overlay" });
    const head = h("div", { class: "missed-lightbox-head" });
    const titleEl = h("div", { class: "missed-lightbox-title" });
    titleEl.innerHTML = `<span><b>#Missed Trade</b> · ${esc(trade.instrument || "")} ${esc(trade.direction || "")} · <span class="pos">+${A.formatNumber(trade.potentialR, 1)}R</span> · <span class="muted">${esc(trade.reason || "")}</span></span>`;

    const tfSwitcher = h("div", { class: "missed-tf-toggle" });
    if (hasHtf && hasLtf) {
      tfSwitcher.innerHTML = `
        <button type="button" class="missed-tf-btn${currentTf === "HTF" ? " active" : ""}" data-lb-tf="HTF">HTF</button>
        <button type="button" class="missed-tf-btn${currentTf === "LTF" ? " active" : ""}" data-lb-tf="LTF">LTF</button>
      `;
    }

    const controls = h("div", { class: "missed-lightbox-controls" });
    const zoomInBtn = h("button", { type: "button", class: "missed-lightbox-btn", text: "Zoom +", title: "Zoom in" });
    const zoomOutBtn = h("button", { type: "button", class: "missed-lightbox-btn", text: "Zoom −", title: "Zoom out" });
    const zoomResetBtn = h("button", { type: "button", class: "missed-lightbox-btn", text: "1:1", title: "Reset zoom" });
    const closeBtn = h("button", { type: "button", class: "missed-lightbox-btn", text: "✕ Close", title: "Close (Esc)" });
    controls.appendChild(zoomInBtn);
    controls.appendChild(zoomOutBtn);
    controls.appendChild(zoomResetBtn);
    controls.appendChild(closeBtn);

    head.appendChild(titleEl);
    if (hasHtf && hasLtf) head.appendChild(tfSwitcher);
    head.appendChild(controls);

    const body = h("div", { class: "missed-lightbox-body" });
    const img = h("img", { class: "missed-lightbox-img", alt: "Missed Trade Chart" });
    body.appendChild(img);

    let prevBtn = null;
    let nextBtn = null;
    if (hasHtf && hasLtf) {
      prevBtn = h("button", { type: "button", class: "missed-lightbox-arrow prev", text: "‹", title: "Previous (Left Arrow)" });
      nextBtn = h("button", { type: "button", class: "missed-lightbox-arrow next", text: "›", title: "Next (Right Arrow)" });
      body.appendChild(prevBtn);
      body.appendChild(nextBtn);
    }

    const hint = h("div", { class: "missed-lightbox-hint", text: "Esc to close · Left/Right arrows to switch HTF/LTF · Scroll to zoom · Drag to pan" });
    body.appendChild(hint);

    overlay.appendChild(head);
    overlay.appendChild(body);
    document.body.appendChild(overlay);

    function updateTransform() {
      img.style.transform = `scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px)`;
    }

    function setImage() {
      const src = currentTf === "HTF" ? trade.htfScreenshot : trade.ltfScreenshot;
      img.src = src || "";
      zoom = 1;
      panX = 0;
      panY = 0;
      updateTransform();
      if (hasHtf && hasLtf) {
        tfSwitcher.querySelectorAll(".missed-tf-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.lbTf === currentTf);
        });
      }
    }

    function toggleTf() {
      if (!hasHtf || !hasLtf) return;
      currentTf = currentTf === "HTF" ? "LTF" : "HTF";
      setImage();
    }

    if (tfSwitcher) {
      tfSwitcher.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-lb-tf]");
        if (btn && btn.dataset.lbTf !== currentTf) {
          currentTf = btn.dataset.lbTf;
          setImage();
        }
      });
    }

    if (prevBtn) prevBtn.addEventListener("click", toggleTf);
    if (nextBtn) nextBtn.addEventListener("click", toggleTf);

    zoomInBtn.addEventListener("click", () => {
      zoom = Math.min(5, zoom + 0.3);
      updateTransform();
    });

    zoomOutBtn.addEventListener("click", () => {
      zoom = Math.max(0.5, zoom - 0.3);
      updateTransform();
    });

    zoomResetBtn.addEventListener("click", () => {
      zoom = 1;
      panX = 0;
      panY = 0;
      updateTransform();
    });

    body.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      zoom = Math.max(0.5, Math.min(6, zoom + delta));
      updateTransform();
    }, { passive: false });

    body.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      body.classList.add("is-dragging");
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      updateTransform();
    });

    window.addEventListener("mouseup", () => {
      isDragging = false;
      body.classList.remove("is-dragging");
    });

    function closeLightbox() {
      window.removeEventListener("keydown", onKey);
      overlay.remove();
    }

    closeBtn.addEventListener("click", closeLightbox);

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        toggleTf();
      }
    }

    window.addEventListener("keydown", onKey);
    setImage();
  }

  function wireEvents() {
    byId("btn-new-trade").addEventListener("click", () => {
      if (model && model.view === "missed") openMissedTradeModal(null);
      else openTradeForm(null);
    });
    byId("btn-missed-trades").addEventListener("click", () => {
      H.setView(model.view === "missed" ? "journal" : "missed");
    });
    byId("btn-back-to-journal").addEventListener("click", () => {
      H.setView("journal");
    });
    byId("btn-empty-log-missed").addEventListener("click", () => {
      openMissedTradeModal(null);
    });

    let missedSearchTimer = null;
    byId("missed-search").addEventListener("input", (e) => {
      clearTimeout(missedSearchTimer);
      missedSearchTimer = setTimeout(() => {
        H.setMissedFilters({ search: e.target.value });
      }, 120);
    });

    byId("missed-filter-instrument").addEventListener("change", (e) => {
      H.setMissedFilters({ instrument: e.target.value || null });
    });
    byId("missed-filter-session").addEventListener("change", (e) => {
      H.setMissedFilters({ session: e.target.value || null });
    });

    byId("missed-reason-pills").addEventListener("click", async (e) => {
      // 1. Delete reason
      const delBtn = e.target.closest("[data-del-filter-reason]");
      if (delBtn) {
        e.stopPropagation();
        e.preventDefault();
        const reasonToDel = delBtn.dataset.delFilterReason;
        const ok = await confirm({
          title: "Remove reason?",
          message: `Remove "${reasonToDel}" from your reasons list? Existing missed trades using it will not be modified.`,
          confirmLabel: "Remove",
          danger: true,
        });
        if (ok) {
          await H.deleteMissedReason(reasonToDel);
          toast("Reason removed.", { type: "success" });
        }
        return;
      }

      // 2. Add reason button
      const addBtn = e.target.closest("#btn-save-filter-reason");
      if (addBtn) {
        e.stopPropagation();
        const input = byId("missed-filter-add-input");
        const val = input ? input.value.trim() : "";
        if (val) {
          await H.saveMissedReason(val);
          toast(`Added reason "${val}".`, { type: "success" });
        }
        return;
      }

      // 3. Select reason pill
      const chip = e.target.closest("[data-reason]");
      if (!chip) return;
      H.setMissedFilters({ reason: chip.dataset.reason });
    });

    byId("missed-reason-pills").addEventListener("keydown", async (e) => {
      if (e.target && e.target.id === "missed-filter-add-input" && e.key === "Enter") {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) {
          await H.saveMissedReason(val);
          toast(`Added reason "${val}".`, { type: "success" });
        }
      }
    });

    byId("missed-grid").addEventListener("click", async (e) => {
      const card = e.target.closest(".missed-card");
      if (!card) return;
      const tradeId = card.dataset.missedId;
      const trade = (model.missedTrades || []).find((t) => String(t.id) === String(tradeId));
      if (!trade) return;

      const tfBtn = e.target.closest("[data-card-tf]");
      if (tfBtn) {
        e.stopPropagation();
        const newTf = tfBtn.dataset.cardTf;
        cardActiveTf.set(trade.id, newTf);
        const img = card.querySelector(".missed-card-screen img");
        const nextSrc = newTf === "HTF" ? trade.htfScreenshot : trade.ltfScreenshot;
        if (img && nextSrc) img.src = nextSrc;
        card.querySelectorAll(".missed-tf-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.cardTf === newTf);
        });
        return;
      }

      const expandBtn = e.target.closest('[data-action="expand"]');
      if (expandBtn) {
        e.stopPropagation();
        const p = card.querySelector(".missed-lesson-text");
        if (p) {
          const isClamped = p.classList.contains("clamp-3");
          p.classList.toggle("clamp-3", !isClamped);
          expandBtn.textContent = isClamped ? "less" : "more";
        }
        return;
      }

      const editBtn = e.target.closest('[data-action="edit"]');
      if (editBtn) {
        e.stopPropagation();
        openMissedTradeModal(trade);
        return;
      }

      const deleteBtn = e.target.closest('[data-action="delete"]');
      if (deleteBtn) {
        e.stopPropagation();
        const ok = await confirm({
          title: "Delete missed trade?",
          message: `Missed setup on ${trade.instrument || "trade"} (${trade.date || "—"}) will be deleted.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (ok) {
          await H.deleteMissedTrade(trade.id);
          toast("Missed trade deleted.", { type: "success" });
        }
        return;
      }

      const screen = e.target.closest('[data-action="lightbox"]');
      if (screen) {
        const activeTf = cardActiveTf.get(trade.id) || "HTF";
        openMissedLightbox(trade, activeTf);
      }
    });
    byId("btn-empty-new").addEventListener("click", () => openTradeForm(null));
    byId("btn-auth-signin")?.addEventListener("click", () => openAuthModal("signin"));
    byId("btn-auth-signup")?.addEventListener("click", () => openAuthModal("signup"));
    byId("btn-auth-signout")?.addEventListener("click", async () => {
      await H.authSignOut();
      toast("Signed out successfully.", { type: "info" });
    });
    byId("btn-migrate-now")?.addEventListener("click", async () => {
      try {
        const res = await H.migrateData();
        toast(`Successfully migrated ${res.tradesUploaded} trades and ${res.missedUploaded} missed trades to Supabase!`, { type: "success" });
      } catch (err) {
        toast(err && err.message ? err.message : "Migration failed.", { type: "error" });
      }
    });
    byId("btn-migrate-dismiss")?.addEventListener("click", () => {
      if (model) model.migrationAvailable = null;
      const b = byId("migration-banner");
      if (b) b.hidden = true;
    });
    byId("btn-templates").addEventListener("click", openTemplatesModal);
    byId("btn-data").addEventListener("click", openDataModal);
    byId("btn-footer-demo").addEventListener("click", openDataModal);
    byId("btn-settings").addEventListener("click", openSettingsModal);
    byId("btn-edit-thresholds").addEventListener("click", openSettingsModal);
    byId("btn-blind").addEventListener("click", () => H.toggleBlind());
    byId("btn-theme").addEventListener("click", () => {
      const nextTheme = model.settings.theme === "light" ? "dark" : "light";
      H.saveSettings(Object.assign({}, model.settings, { theme: nextTheme }));
    });
    byId("btn-hide-panels").addEventListener("click", () => {
      const nextHidden = !(model.settings && model.settings.hidePanels);
      H.saveSettings(Object.assign({}, model.settings, { hidePanels: nextHidden }));
    });
    byId("btn-footer-export").addEventListener("click", async () => {
      try { await H.exportJSON(); toast("Backup exported.", { type: "success" }); } catch (err) { toast(err.message || "Export failed.", { type: "error" }); }
    });
    byId("btn-empty-demo").addEventListener("click", async () => {
      await H.loadDemo(100);
      toast("100 demo trades loaded.", { type: "success" });
    });

    byId("backup-reminder").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-backup]");
      if (!btn) return;
      if (btn.dataset.backup === "export") {
        Promise.resolve(H.exportJSON()).then(() => toast("Backup exported.", { type: "success" })).catch((err) => toast(err.message || "Export failed.", { type: "error" }));
      } else {
        H.saveSettings(Object.assign({}, model.settings, { backupReminder: false }));
      }
    });

    byId("blind-banner").addEventListener("change", (event) => {
      const box = event.target.closest("#blind-hide-toggle");
      if (!box) return;
      H.saveSettings(Object.assign({}, model.settings, { blindHideResults: box.checked }));
    });

    byId("btn-advanced-filters").addEventListener("click", () => openPopover(byId("advanced-filters"), byId("btn-advanced-filters")));
    byId("btn-close-filters").addEventListener("click", closePopover);
    byId("btn-clear-filters").addEventListener("click", async () => {
      closePopover();
      await H.clearFilters();
    });
    byId("btn-columns").addEventListener("click", () => openPopover(byId("columns-popover"), byId("btn-columns")));
    byId("btn-columns-close").addEventListener("click", closePopover);
    byId("btn-columns-reset").addEventListener("click", async () => {
      const columns = {};
      A.COLUMNS.forEach((col) => (columns[col.key] = !!col.default));
      model.settings.columns = columns;
      await H.saveSettings(Object.assign({}, model.settings, { columns }));
      toast("Columns reset.", { type: "success" });
    });
    byId("columns-list").addEventListener("change", async (event) => {
      const box = event.target.closest("[data-column]");
      if (!box) return;
      const columns = Object.assign({}, model.settings.columns);
      columns[box.dataset.column] = box.checked;
      model.settings.columns = columns;
      await H.saveSettings(Object.assign({}, model.settings, { columns }));
    });
    byId("btn-clear-selection").addEventListener("click", () => {
      selection.clear();
      renderTable();
    });
    byId("btn-apply-template").addEventListener("click", openApplyTemplateModal);

    byId("quick-filters").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-quick]");
      if (!chip) return;
      const quick = chip.dataset.quick;
      if (quick === "all") H.setFilters({ result: null, mfeAtLeast: null });
      else H.setFilters({ result: quick });
    });
    byId("quick-mfe-atleast").addEventListener("change", (event) => {
      H.setFilters({ mfeAtLeast: event.target.value === "" ? null : A.toNum(event.target.value) });
    });

    byId("search-input").addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = setTimeout(() => H.setFilters({ search: value }), 260);
    });

    const filterMap = {
      "filter-instrument": "instrument",
      "filter-session": "session",
      "filter-result": "result",
      "filter-dataset": "dataset",
      "filter-setup": "setup",
      "filter-quality": "quality",
      "filter-status": "status",
      "filter-exit-plan": "exitPlanKey",
      "filter-date-from": "dateFrom",
      "filter-date-to": "dateTo",
    };
    Object.keys(filterMap).forEach((id) => {
      byId(id).addEventListener("change", (event) => {
        H.setFilters({ [filterMap[id]]: event.target.value || null });
      });
    });
    const numberFilterMap = {
      "filter-mfe-min": "mfeMin",
      "filter-mfe-max": "mfeMax",
      "filter-mae-min": "maeMin",
      "filter-mae-max": "maeMax",
      "filter-final-min": "finalRMin",
      "filter-final-max": "finalRMax",
    };
    Object.keys(numberFilterMap).forEach((id) => {
      byId(id).addEventListener("change", (event) => {
        clearTimeout(numericTimer);
        const value = event.target.value;
        numericTimer = setTimeout(() => H.setFilters({ [numberFilterMap[id]]: value === "" ? null : A.toNum(value) }), 220);
      });
    });

    byId("trade-thead").addEventListener("click", (event) => {
      const th = event.target.closest("[data-sort]");
      if (!th) return;
      if (H.setSort) H.setSort(th.dataset.sort);
      else {
        const key = th.dataset.sort;
        const dir = model.sort.key === key && model.sort.dir === "asc" ? "desc" : "asc";
        model.sort = { key, dir };
        renderTable();
      }
    });

    byId("trade-thead").addEventListener("change", (event) => {
      const master = event.target.closest("#select-all");
      if (!master) return;
      const ids = (model.tableTrades || []).map((t) => t.id);
      if (master.checked) ids.forEach((id) => selection.add(id));
      else ids.forEach((id) => selection.delete(id));
      renderTable();
    });

    byId("trade-tbody").addEventListener("change", (event) => {
      const box = event.target.closest("[data-select]");
      if (!box) return;
      const tr = box.closest("tr");
      if (!tr) return;
      if (box.checked) selection.add(tr.dataset.id);
      else selection.delete(tr.dataset.id);
      tr.classList.toggle("is-selected", box.checked);
      updateSelectionUI();
      const master = byId("select-all");
      if (master) {
        const ids = (model.tableTrades || []).map((t) => t.id);
        const all = ids.length > 0 && ids.every((id) => selection.has(id));
        master.checked = all;
        master.indeterminate = selection.size > 0 && !all;
      }
    });

    byId("trade-tbody").addEventListener("click", async (event) => {
      const row = event.target.closest("tr[data-id]");
      if (!row) return;
      const trade = (model.tableTrades || []).find((t) => t.id === row.dataset.id);
      if (!trade) return;
      const actionEl = event.target.closest("[data-action]");
      if (actionEl) {
        const action = actionEl.dataset.action;
        if (action === "details") {
          openDetails(trade.id);
        } else if (action === "plan") {
          openTradePlanEditor(trade);
        } else if (action === "complete") {
          openCompleteForm(trade);
        } else if (action === "duplicate") {
          const copy = await H.duplicateTrade(trade.id);
          toast("Trade duplicated.", { type: "success" });
          if (copy && copy.id) openDetails(copy.id);
        } else if (action === "delete") {
          const shots = await Promise.resolve(H.listScreenshots ? H.listScreenshots(trade.id) : []);
          const ok = await confirm({
            title: "Delete trade?",
            message: "Trade #" + (trade.tradeNumber || "—") + ((shots && shots.length) ? " and its " + shots.length + " screenshot(s)" : "") + " will be permanently deleted.",
            confirmLabel: "Delete",
            danger: true,
          });
          if (ok) {
            const snapshot = await H.deleteTrade(trade.id);
            toast("Trade deleted.", {
              type: "success",
              actionLabel: "Undo",
              duration: 15000,
              onAction: async () => {
                await H.restoreTrade(snapshot);
                toast("Trade restored.", { type: "success" });
              },
            });
          }
        }
        return;
      }
      const td = event.target.closest("td[data-field]");
      if (td && !event.target.closest("button, input, select, textarea, a")) {
        beginInlineEdit(td, trade, td.dataset.field);
      }
    });

    document.addEventListener("click", (event) => {
      const orderBtn = event.target.closest("[data-order]");
      if (orderBtn) {
        if (H.setOrderBy) H.setOrderBy(orderBtn.dataset.order);
        return;
      }
      if (currentPopover) {
        const pop = currentPopover.el;
        if (!pop.contains(event.target) && !(currentPopover.anchor && currentPopover.anchor.contains(event.target)) && !event.target.closest("#btn-advanced-filters, #btn-columns")) {
          closePopover();
        }
      }
    });

    byId("analytics-tabs").addEventListener("click", (event) => {
      const tab = event.target.closest("[data-tab]");
      if (!tab) return;
      model.analyticsTab = tab.dataset.tab;
      renderAnalytics();
      H.saveSettings(Object.assign({}, model.settings, { visibleAnalytics: tab }));
    });

    byId("analytics-body").addEventListener("click", async (event) => {
      const mode = event.target.closest("[data-comparison-mode]");
      if (mode) {
        comparisonMode = mode.dataset.comparisonMode;
        renderAnalytics();
        return;
      }
      const settingsBtn = event.target.closest("[data-open-settings]");
      if (settingsBtn) {
        openSettingsModal();
      }
    });

    byId("analytics-body").addEventListener("change", (event) => {
      const planBox = event.target.closest("[data-plan-check]");
      if (planBox) {
        if (planBox.checked) selectedPlanIds.add(planBox.dataset.planCheck);
        else selectedPlanIds.delete(planBox.dataset.planCheck);
        renderAnalytics();
        return;
      }
      const toggle = event.target.closest("[data-setting-toggle]");
      if (toggle) {
        const key = toggle.dataset.settingToggle;
        H.saveSettings(Object.assign({}, model.settings, { [key]: toggle.checked }));
      }
    });

    byId("import-file").addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      await handleImportFile(file);
    });

    document.addEventListener("keydown", (event) => {
      const active = document.activeElement;
      const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
      if (event.key === "Escape") {
        if (modalStack.length) {
          event.preventDefault();
          closeTopModal();
          return;
        }
        if (currentPopover) {
          closePopover();
          return;
        }
        if (detailsId) {
          closeDetails();
          return;
        }
      }
      if (typing || modalStack.length) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (model && model.view === "missed") openMissedTradeModal(null);
        else openTradeForm(null);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (model && model.view === "missed") {
          const ms = byId("missed-search");
          if (ms) { ms.focus(); ms.select(); }
        } else {
          byId("search-input").focus();
          byId("search-input").select();
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        Promise.resolve(H.exportJSON()).then(() => toast("Backup exported.", { type: "success" })).catch((err) => toast(err.message || "Export failed.", { type: "error" }));
      } else if (event.key === "/") {
        event.preventDefault();
        byId("search-input").focus();
      } else if (event.key.toLowerCase() === "b" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        H.toggleBlind();
      }
    });
  }

  function init(initialModel, api) {
    model = initialModel;
    handlers = api || {};
    H = handlers;
    ensureDetailsPanel();
    if (!wired) {
      wireEvents();
      wired = true;
    }
    if (!model.analyticsTab) model.analyticsTab = (model.settings && model.settings.visibleAnalytics) || "session";
    if (model.blind === undefined) model.blind = !!(model.settings && model.settings.blindMode);
    setPanelVisibility();
    render();
  }

  window.ICT = window.ICT || {};
  window.ICT.ui = {
    init,
    render,
    openTradeForm,
    openCompleteForm,
    openDetails,
    closeDetails,
    openTemplatesModal,
    openSettingsModal,
    openDataModal,
    openTradePlanEditor,
    confirm,
    prompt,
    toast,
    closeTopModal,
    getSelection: () => Array.from(selection),
    clearSelection: () => {
      selection.clear();
      renderTable();
    },
  };
})();
