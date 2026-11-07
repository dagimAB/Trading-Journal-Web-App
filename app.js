(function () {
  "use strict";

  const A = window.ICT.analytics;
  const DB = window.ICT.db;

  const FILTER_DEFAULTS = {
    search: "",
    instrument: null,
    session: null,
    direction: null,
    setup: null,
    quality: null,
    result: null,
    status: null,
    dataset: null,
    exitPlanKey: null,
    dateFrom: "",
    dateTo: "",
    mfeMin: null,
    mfeMax: null,
    maeMin: null,
    maeMax: null,
    finalRMin: null,
    finalRMax: null,
    mfeAtLeast: null,
  };

  const MISSED_FILTER_DEFAULTS = {
    search: "",
    instrument: null,
    session: null,
    reason: "All",
  };

  let rawTrades = [];
  let missedTrades = [];
  let missedReasons = [];
  let screenshots = [];
  let cachedHidePanels = false;
  if (typeof localStorage !== "undefined") {
    const val = localStorage.getItem("ict_hide_panels");
    if (val !== null) cachedHidePanels = val === "true";
  }
  let settings = Object.assign({}, A.defaultSettings(), { hidePanels: cachedHidePanels });
  let filters = Object.assign({}, FILTER_DEFAULTS);
  let missedFilters = Object.assign({}, MISSED_FILTER_DEFAULTS);
  let sort = { key: "tradeNumber", dir: "asc" };
  let initialized = false;

  const state = {
    view: "journal", // "journal" | "missed"
    allTrades: [],
    filteredTrades: [],
    tableTrades: [],
    missedTrades: [],
    filteredMissedTrades: [],
    missedReasons: [],
    missedStats: { total: 0, totalR: 0, avgR: 0, topReason: "—", topReasonCount: 0, reasonCounts: {} },
    missedFilters,
    templates: [],
    settings,
    filters,
    sort,
    stats: A.computeStats([], {}),
    blind: false,
    backupDue: false,
    backupDays: 0,
    analyticsTab: "session",
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function genId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function nextTradeNumber() {
    return rawTrades.reduce((max, t) => Math.max(max, parseInt(t.tradeNumber, 10) || 0), 0) + 1;
  }

  function sanitizeTrade(trade) {
    const tp = trade.tradePath || {};
    const entryScreenshots = A.screenshotUrls(trade, "entry");
    const outcomeScreenshots = A.screenshotUrls(trade, "outcome");
    return {
      id: trade.id,
      tradeNumber: A.toNum(trade.tradeNumber),
      date: trade.date || "",
      time: trade.time || "",
      session: trade.session || "",
      killzone: trade.killzone || "",
      instrument: trade.instrument || "",
      direction: trade.direction || "",
      htfBias: trade.htfBias || "",
      htfTimeframe: trade.htfTimeframe || "",
      entryTimeframe: trade.entryTimeframe || "",
      setup: trade.setup || "",
      setupQuality: trade.setupQuality || "",
      entry: A.toNum(trade.entry),
      stopLoss: A.toNum(trade.stopLoss),
      wickRr: trade.wickRr !== undefined && trade.wickRr !== null && trade.wickRr !== "" ? trade.wickRr : null,
      bodyRr: trade.bodyRr !== undefined && trade.bodyRr !== null && trade.bodyRr !== "" ? trade.bodyRr : null,
      spcSl: trade.spcSl !== undefined && trade.spcSl !== null && trade.spcSl !== "" ? trade.spcSl : (trade.spcRr !== undefined && trade.spcRr !== null && trade.spcRr !== "" ? trade.spcRr : null),
      riskR: A.toNum(trade.riskR),
      exitPlan: Array.isArray(trade.exitPlan) ? trade.exitPlan.map((l) => ({ allocation: A.toNum(l.allocation), targetR: A.toNum(l.targetR) })) : [],
      exitPlanTemplateId: trade.exitPlanTemplateId || null,
      exitPlanTemplateName: trade.exitPlanTemplateName || "",
      tradePath: {
        mfe: A.toNum(tp.mfe),
        mae: A.toNum(tp.mae),
        pathComplete: !!tp.pathComplete,
        waypoints: Array.isArray(tp.waypoints) ? tp.waypoints.slice() : null,
      },
      remainderExitR: A.toNum(trade.remainderExitR),
      levelsHitOverride: Array.isArray(trade.levelsHitOverride) ? trade.levelsHitOverride.map(Boolean) : null,
      finalROverride: A.toNum(trade.finalROverride),
      exitReason: trade.exitReason || null,
      screenshotBefore: trade.screenshotBefore || null,
      screenshotAfter: trade.screenshotAfter || null,
      entryScreenshot: entryScreenshots[0] || null,
      outcomeScreenshot: outcomeScreenshots[0] || null,
      entryScreenshots,
      outcomeScreenshots,
      notes: trade.notes || "",
      dataset: trade.dataset || "",
      isDemo: !!trade.isDemo,
      isCopy: !!trade.isCopy,
      status: A.finalR(trade) === null ? "incomplete" : "completed",
      createdAt: trade.createdAt || new Date().toISOString(),
      updatedAt: trade.updatedAt || new Date().toISOString(),
    };
  }

  function screenshotCounts() {
    const map = new Map();
    screenshots.forEach((shot) => {
      const key = String(shot.tradeId);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }

  function decorateAll(raw) {
    const counts = screenshotCounts();
    return raw.map((trade) => {
      const decorated = A.decorate(trade);
      const galleryCount = counts.get(String(trade.id)) || 0;
      const legacyCount = !galleryCount && (trade.screenshotBefore || trade.screenshotAfter) ? 1 : 0;
      const dedicatedCount = A.screenshotUrls(trade, "entry").length + A.screenshotUrls(trade, "outcome").length;
      decorated.screenshotCount = galleryCount + legacyCount + dedicatedCount;
      return decorated;
    });
  }

  function backupStatus() {
    return { due: false, days: 0 };
  }

  function sanitizeMissedTrade(trade) {
    return {
      id: trade.id || genId("missed"),
      date: trade.date || todayISO(),
      instrument: trade.instrument || "",
      session: trade.session || "",
      direction: trade.direction || "Long",
      potentialR: A.toNum(trade.potentialR) !== null ? A.toNum(trade.potentialR) : 0,
      reason: trade.reason ? String(trade.reason).trim() : "Hesitation",
      notes: trade.notes ? String(trade.notes).trim() : "",
      htfScreenshot: trade.htfScreenshot || null,
      ltfScreenshot: trade.ltfScreenshot || null,
      createdAt: trade.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function rebuildMissed() {
    const filtered = A.filterMissedTrades(missedTrades, missedFilters);
    filtered.sort((a, b) => {
      const cmp = String(b.date || "").localeCompare(String(a.date || ""));
      if (cmp !== 0) return cmp;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    const stats = A.computeMissedStats(missedTrades);
    state.missedTrades = missedTrades;
    state.filteredMissedTrades = filtered;
    state.missedStats = stats;
    state.missedFilters = missedFilters;
  }

  function rebuild() {
    const decorated = decorateAll(rawTrades);
    const filtered = A.applyFilters(decorated, filters, settings);
    const tableTrades = A.sortTrades(filtered, sort.key, sort.dir);
    const stats = A.computeStats(filtered, {
      orderBy: settings.orderBy,
      breakevenTolerance: settings.breakevenTolerance,
    });
    const backup = backupStatus();
    state.allTrades = decorated;
    state.filteredTrades = filtered;
    state.tableTrades = tableTrades;
    state.settings = settings;
    state.filters = filters;
    state.sort = sort;
    state.stats = stats;
    state.blind = !!settings.blindMode;
    state.backupDue = backup.due;
    state.backupDays = backup.days;
    state.analyticsTab = settings.visibleAnalytics || state.analyticsTab || "session";
    if (!state.settings.columns) state.settings.columns = A.defaultSettings().columns;
    rebuildMissed();
  }

  function render() {
    if (!initialized) return;
    window.ICT.ui.render();
  }

  async function load() {
    const [trades, storedTemplates, storedSettings, storedMissed, storedReasons] = await Promise.all([
      DB.getAllTrades(),
      DB.getAllTemplates(),
      DB.getAllSettings(),
      DB.getMissedTrades(),
      DB.getMissedReasons(),
    ]);
    const firstRun = !storedSettings || Object.keys(storedSettings).length === 0;
    settings = A.mergeSettings(storedSettings);
    if (typeof localStorage !== "undefined") {
      if (localStorage.getItem("ict_hide_panels") !== null) {
        settings.hidePanels = localStorage.getItem("ict_hide_panels") === "true";
      } else if (storedSettings && storedSettings.hidePanels !== undefined) {
        settings.hidePanels = Boolean(storedSettings.hidePanels);
      }
      if (localStorage.getItem("ict_theme")) {
        settings.theme = localStorage.getItem("ict_theme");
      }
      if (localStorage.getItem("ict_columns")) {
        try {
          const localCols = JSON.parse(localStorage.getItem("ict_columns"));
          if (localCols && typeof localCols === "object") {
            settings.columns = Object.assign({}, settings.columns, localCols);
          }
        } catch (_) {}
      }
      localStorage.setItem("ict_hide_panels", settings.hidePanels ? "true" : "false");
    }
    let templates = storedTemplates;
    if (!storedSettings || !storedSettings.templatesInitialized) {
      if (!templates.length) {
        templates = A.defaultTemplates();
        await DB.putTemplates(templates);
      }
      settings.templatesInitialized = true;
      await DB.setSettings(settings);
    } else if (firstRun) {
      await DB.setSettings(settings);
    }
    rawTrades = trades;
    missedTrades = Array.isArray(storedMissed) ? storedMissed : [];
    missedReasons = Array.isArray(storedReasons) && storedReasons.length ? storedReasons : A.DEFAULT_MISSED_REASONS.slice();
    state.missedReasons = missedReasons;
    state.templates = templates.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }));
    screenshots = await DB.getAllScreenshots();
    rebuild();
  }

  async function refresh() {
    await load();
    render();
  }

  function showFatal(error) {
    const banner = byId("db-error");
    if (!banner) return;
    banner.hidden = false;
    banner.innerHTML = `<strong>Storage error.</strong> ${String(error && error.message ? error.message : error)} <span class="muted">Try a modern browser, or serve the folder over http:// rather than opening the file directly.</span>`;
  }

  function getRaw(id) {
    return rawTrades.find((t) => String(t.id) === String(id));
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  let saveSettingsTimer = null;
  async function saveSettings(nextSettings, options) {
    if (typeof localStorage !== "undefined") {
      if (nextSettings && nextSettings.hidePanels !== undefined) {
        localStorage.setItem("ict_hide_panels", nextSettings.hidePanels ? "true" : "false");
      }
      if (nextSettings && nextSettings.theme) {
        localStorage.setItem("ict_theme", nextSettings.theme);
      }
      if (nextSettings && nextSettings.columns) {
        localStorage.setItem("ict_columns", JSON.stringify(nextSettings.columns));
      }
    }
    settings = A.mergeSettings(nextSettings);
    if (nextSettings && nextSettings.hidePanels !== undefined) {
      settings.hidePanels = Boolean(nextSettings.hidePanels);
    }
    state.settings = settings;
    state.blind = !!settings.blindMode;
    rebuild();
    if (!options || options.render !== false) render();

    if (saveSettingsTimer) clearTimeout(saveSettingsTimer);
    if (options && options.immediate) {
      try {
        await DB.setSettings(settings);
      } catch (err) {
        console.warn("Could not save settings to DB:", err);
      }
      return settings;
    }

    saveSettingsTimer = setTimeout(async () => {
      try {
        await DB.setSettings(settings);
      } catch (err) {
        console.warn("Could not save settings to DB:", err);
      }
    }, 300);

    return settings;
  }

  async function saveTrade(trade) {
    const next = sanitizeTrade(trade);
    if (!next.tradeNumber) next.tradeNumber = nextTradeNumber();
    if (!next.id) next.id = genId("trade");
    if (!next.createdAt) next.createdAt = new Date().toISOString();
    next.updatedAt = new Date().toISOString();

    // Auto-save custom setups & batches
    let settingsUpdated = false;
    const defaultSetups = A.DEFAULTS?.setups || [
      "FVG",
      "Order Block",
      "Liquidity Sweep",
      "Breaker",
      "OTE",
      "MSS",
      "Displacement",
      "FVG + Sweep",
      "OB + Sweep",
    ];
    const customSetups = Array.isArray(settings.customSetups) ? settings.customSetups.slice() : [];
    if (next.setup && !defaultSetups.includes(next.setup) && !customSetups.includes(next.setup)) {
      customSetups.push(next.setup);
      settings.customSetups = customSetups;
      if (state.settings) state.settings.customSetups = customSetups;
      settingsUpdated = true;
    }
    const customBatches = Array.isArray(settings.customBatches) ? settings.customBatches.slice() : [];
    if (next.dataset && !customBatches.includes(next.dataset)) {
      customBatches.push(next.dataset);
      settings.customBatches = customBatches;
      if (state.settings) state.settings.customBatches = customBatches;
      settingsUpdated = true;
    }
    if (settingsUpdated) {
      await saveSettings(settings, { render: false, immediate: true });
    }

    await DB.putTrade(next);
    await load();
    render();
    return next;
  }

  async function updateTrade(id, patch) {
    const raw = getRaw(id);
    if (!raw) return { ok: false, errors: ["Trade not found."] };
    const merged = Object.assign({}, raw, patch);
    if (patch && patch.tradePath) merged.tradePath = Object.assign({}, raw.tradePath || {}, patch.tradePath);
    const next = sanitizeTrade(merged);
    const check = A.validateTrade(next);
    if (!check.valid) {
      return { ok: false, errors: check.errors.map((e) => e.message), warnings: check.warnings.map((w) => w.message) };
    }
    next.updatedAt = new Date().toISOString();

    const defaultSetups = A.DEFAULTS?.setups || [
      "FVG",
      "Order Block",
      "Liquidity Sweep",
      "Breaker",
      "OTE",
      "MSS",
      "Displacement",
      "FVG + Sweep",
      "OB + Sweep",
    ];
    const customSetups = Array.isArray(settings.customSetups) ? settings.customSetups.slice() : [];
    if (next.setup && !defaultSetups.includes(next.setup) && !customSetups.includes(next.setup)) {
      customSetups.push(next.setup);
      settings.customSetups = customSetups;
      if (state.settings) state.settings.customSetups = customSetups;
      await saveSettings(settings, { render: false, immediate: true });
    }

    await DB.putTrade(next);
    await load();
    render();
    return { ok: true, warnings: check.warnings.map((w) => w.message) };
  }

  async function duplicateTrade(id) {
    const raw = getRaw(id);
    if (!raw) return null;
    const copy = sanitizeTrade(Object.assign({}, raw, {
      id: genId("trade"),
      tradeNumber: nextTradeNumber(),
      isDemo: false,
      isCopy: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tradePath: Object.assign({}, raw.tradePath),
      exitPlan: (raw.exitPlan || []).map((l) => ({ ...l })),
      levelsHitOverride: Array.isArray(raw.levelsHitOverride) ? raw.levelsHitOverride.slice() : null,
      screenshotBefore: null,
      screenshotAfter: null,
    }));
    await DB.putTrade(copy);
    await load();
    render();
    return copy;
  }

  async function deleteTrade(id) {
    const raw = getRaw(id);
    const removedShots = screenshots.filter((s) => String(s.tradeId) === String(id));
    const shotIds = removedShots.map((s) => s.id);
    if (shotIds.length) await DB.deleteScreenshots(shotIds);
    await DB.deleteTrade(id);
    screenshots = screenshots.filter((s) => String(s.tradeId) !== String(id));
    await load();
    render();
    return raw ? { trade: raw, screenshots: removedShots } : null;
  }

  async function restoreTrade(snapshot) {
    if (!snapshot || !snapshot.trade) return false;
    await DB.putTrade(snapshot.trade);
    for (const shot of snapshot.screenshots || []) await DB.putScreenshot(shot);
    await load();
    render();
    return true;
  }

  async function saveTemplate(template) {
    const next = {
      id: template.id || genId("tpl"),
      name: String(template.name || "").trim(),
      levels: (template.levels || []).map((l) => ({ allocation: A.toNum(l.allocation), targetR: A.toNum(l.targetR) })),
      createdAt: template.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const check = A.validateExitPlan(next.levels);
    if (!next.name) throw new Error("Template name is required.");
    if (!check.valid) throw new Error(check.errors[0].message);
    await DB.putTemplate(next);
    await load();
    render();
    return next;
  }

  async function deleteTemplate(id) {
    await DB.deleteTemplate(id);
    await load();
    render();
  }

  async function listScreenshots(tradeId) {
    return screenshots
      .filter((s) => String(s.tradeId) === String(tradeId))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  async function saveScreenshot(shot) {
    const next = Object.assign({}, shot, { tradeId: String(shot.tradeId), createdAt: shot.createdAt || new Date().toISOString() });
    await DB.putScreenshot(next);
    screenshots = screenshots.filter((s) => s.id !== next.id).concat([next]);
    rebuild();
    render();
    return next;
  }

  async function deleteScreenshot(id) {
    await DB.deleteScreenshot(id);
    screenshots = screenshots.filter((s) => s.id !== id);
    rebuild();
    render();
  }

  async function mergeImport(payload, options) {
    const result = await DB.mergeAll(payload, options || {});
    await load();
    render();
    return result;
  }

  async function replaceImport(payload) {
    const result = await DB.replaceAll(payload);
    filters = Object.assign({}, FILTER_DEFAULTS);
    sort = { key: "tradeNumber", dir: "asc" };
    await load();
    render();
    return result;
  }

  async function loadDemo(count) {
    if (DB.isSupabaseActive && DB.isSupabaseActive()) {
      await DB.insertDemoTrades(state.user ? state.user.id : null);
      if (!missedTrades.length) {
        await DB.putMissedTrade(sanitizeMissedTrade({
          date: todayISO(),
          instrument: "S&P500",
          session: "London",
          direction: "Long",
          potentialR: 5.5,
          reason: "Hesitation",
          notes: "Clean liquidity sweep into 15M FVG during London open. Hesitated pulling the trigger due to prior loss. Must execute without second-guessing.",
        }));
        await DB.putMissedTrade(sanitizeMissedTrade({
          date: todayISO(),
          instrument: "NAS100",
          session: "New York AM",
          direction: "Short",
          potentialR: 7.2,
          reason: "Missed Alert",
          notes: "Alert triggered at key swing high during 9:50 AM silver bullet window. Was away from desk. Keep push notifications active on mobile.",
        }));
      }
      await load();
      render();
      return 6;
    }
    const demo = A.generateDemoTrades(count, { dataset: "Demo Data" });
    const offset = rawTrades.reduce((max, t) => Math.max(max, parseInt(t.tradeNumber, 10) || 0), 0);
    demo.forEach((trade, index) => {
      trade.tradeNumber = offset + index + 1;
      trade.id = genId("demo");
    });
    await DB.putTrades(demo);
    if (!missedTrades.length) {
      missedTrades = [
        sanitizeMissedTrade({
          id: genId("demo-missed"),
          date: todayISO(),
          instrument: "S&P500",
          session: "London",
          direction: "Long",
          potentialR: 5.5,
          reason: "Hesitation",
          notes: "Clean liquidity sweep into 15M FVG during London open. Hesitated pulling the trigger due to prior loss. Must execute without second-guessing.",
          isDemo: true,
        }),
        sanitizeMissedTrade({
          id: genId("demo-missed"),
          date: todayISO(),
          instrument: "NAS100",
          session: "New York AM",
          direction: "Short",
          potentialR: 7.2,
          reason: "Missed Alert",
          notes: "Alert triggered at key swing high during 9:50 AM silver bullet window. Was away from desk. Keep push notifications active on mobile.",
          isDemo: true,
        }),
      ];
      if (DB.saveMissedTrades) await DB.saveMissedTrades(missedTrades);
    }
    await load();
    render();
    return demo.length;
  }

  async function clearDemo() {
    const demoIds = rawTrades.filter((t) => t.isDemo).map((t) => String(t.id));
    const shotIds = screenshots.filter((s) => demoIds.includes(String(s.tradeId))).map((s) => s.id);
    if (shotIds.length) await DB.deleteScreenshots(shotIds);
    await DB.deleteDemoTrades();
    missedTrades = missedTrades.filter((m) => !m.isDemo);
    if (DB.saveMissedTrades) DB.saveMissedTrades(missedTrades);
    await load();
    render();
  }

  async function clearAll() {
    await DB.clearTradeData();
    filters = Object.assign({}, FILTER_DEFAULTS);
    sort = { key: "tradeNumber", dir: "asc" };
    await load();
    if (window.ICT.ui) window.ICT.ui.clearSelection();
    render();
  }

  async function exportJSON() {
    settings = A.mergeSettings(Object.assign({}, settings, { lastExportDate: new Date().toISOString() }));
    await DB.setSettings(settings);
    state.settings = settings;
    const payload = await DB.exportAll();
    download("ict-journal-backup-" + todayISO() + ".json", JSON.stringify(payload, null, 2), "application/json");
    rebuild();
    render();
  }

  async function exportCSV() {
    const rows = state.allTrades.slice().sort((a, b) => (a.tradeNumber || 0) - (b.tradeNumber || 0));
    const headers = [
      "tradeNumber", "date", "time", "session", "killzone", "instrument", "direction", "setup", "setupQuality",
      "htfBias", "htfTimeframe", "entryTimeframe", "entry", "stopLoss", "riskR", "exitPlan", "exitPlanTemplateName",
      "mfe", "mae", "remainderExitR", "finalR", "exitReason", "levelsHit", "pathComplete", "waypoints",
      "screenshots", "dataset", "isDemo", "notes",
    ];
    const lines = [headers.join(",")];
    rows.forEach((t) => {
      lines.push([
        t.tradeNumber,
        t.date,
        t.time,
        t.session,
        t.killzone,
        t.instrument,
        t.direction,
        A.setupComponents(t).join(" + "),
        t.setupQuality,
        t.htfBias,
        t.htfTimeframe,
        t.entryTimeframe,
        t.entry,
        t.stopLoss,
        t.riskR,
        A.planString(t.exitPlan),
        t.exitPlanTemplateName,
        t.mfe,
        t.mae,
        t.effectiveRemainder,
        t.finalR,
        t.exitReason,
        t.levelsHitLabel,
        t.pathComplete ? "Yes" : "No",
        t.tradePath && Array.isArray(t.tradePath.waypoints) ? t.tradePath.waypoints.join(" | ") : "",
        t.screenshotCount || 0,
        t.dataset,
        t.isDemo ? "Yes" : "No",
        t.notes,
      ].map(csvCell).join(","));
    });
    download("ict-journal-trades-" + todayISO() + ".csv", "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
  }

  async function applyTemplateToSelection(ids, templateId) {
    const tpl = state.templates.find((t) => t.id === templateId);
    if (!tpl) throw new Error("Exit Plan not found.");
    const updates = [];
    for (const id of ids) {
      const raw = getRaw(id);
      if (!raw) continue;
      const next = sanitizeTrade(Object.assign({}, raw, {
        exitPlan: tpl.levels.map((l) => ({ ...l })),
        exitPlanTemplateId: tpl.id,
        exitPlanTemplateName: tpl.name,
        updatedAt: new Date().toISOString(),
      }));
      const check = A.validateTrade(next);
      if (!check.valid) throw new Error("Trade #" + (next.tradeNumber || "—") + ": " + check.errors[0].message);
      updates.push(next);
    }
    await DB.putTrades(updates);
    await load();
    render();
    return updates.length;
  }

  async function saveMissedTrade(draft) {
    const next = sanitizeMissedTrade(draft);
    const check = A.validateMissedTrade(next);
    if (!check.valid) {
      return { ok: false, errors: check.errors.map((e) => e.message) };
    }
    await DB.putMissedTrade(next);
    await load();
    render();
    return { ok: true, trade: next };
  }

  async function deleteMissedTrade(id) {
    const found = missedTrades.find((m) => String(m.id) === String(id));
    await DB.deleteMissedTrade(id);
    await load();
    render();
    return found || null;
  }

  function setMissedFilters(patch) {
    missedFilters = Object.assign({}, missedFilters, patch || {});
    rebuildMissed();
    render();
  }

  function clearMissedFilters() {
    missedFilters = Object.assign({}, MISSED_FILTER_DEFAULTS);
    rebuildMissed();
    render();
  }

  async function saveMissedReason(newReason) {
    const trimmed = String(newReason || "").trim();
    if (!trimmed) return { ok: false, error: "Reason cannot be empty." };
    const exists = missedReasons.some((r) => r.toLowerCase() === trimmed.toLowerCase());
    if (!exists) {
      missedReasons.push(trimmed);
      await DB.saveMissedReasons(missedReasons);
    }
    state.missedReasons = missedReasons;
    render();
    return { ok: true, reason: trimmed };
  }

  async function deleteMissedReason(reasonToDelete) {
    const target = String(reasonToDelete || "").trim().toLowerCase();
    missedReasons = missedReasons.filter((r) => r.toLowerCase() !== target);
    await DB.saveMissedReasons(missedReasons);
    state.missedReasons = missedReasons;
    if (missedFilters.reason && missedFilters.reason.toLowerCase() === target) {
      missedFilters.reason = "All";
      rebuildMissed();
    }
    render();
    return { ok: true };
  }

  function setView(view) {
    state.view = view === "missed" ? "missed" : (view === "profile" ? "profile" : "journal");
    render();
  }

  const handlers = {
    reload: refresh,
    saveTrade,
    updateTrade,
    duplicateTrade,
    deleteTrade,
    restoreTrade,
    saveMissedTrade,
    deleteMissedTrade,
    saveMissedReason,
    deleteMissedReason,
    getMissedReasons: () => missedReasons,
    setMissedFilters,
    clearMissedFilters,
    setView,
    getMissedTrades: () => missedTrades,
    saveTemplate,
    deleteTemplate,
    countTemplateUsage: (id) => DB.countTemplatesForTrade(id),
    applyTemplateToSelection,
    saveSettings,
    listScreenshots,
    saveScreenshot,
    deleteScreenshot,
    setFilters: function (patch) {
      filters = Object.assign({}, filters, patch || {});
      Object.keys(FILTER_DEFAULTS).forEach((key) => {
        if (filters[key] === undefined) filters[key] = FILTER_DEFAULTS[key];
      });
      rebuild();
      render();
    },
    clearFilters: function () {
      filters = Object.assign({}, FILTER_DEFAULTS);
      rebuild();
      render();
    },
    setSort: function (key) {
      if (!key) return;
      if (sort.key === key) sort.dir = sort.dir === "asc" ? "desc" : "asc";
      else sort = { key, dir: "asc" };
      state.sort = sort;
      const filtered = state.filteredTrades;
      state.tableTrades = A.sortTrades(filtered, sort.key, sort.dir);
      render();
    },
    setOrderBy: async function (orderBy) {
      await saveSettings(Object.assign({}, settings, { orderBy: orderBy === "chronological" ? "chronological" : "tradeNumber" }), { render: false });
      render();
    },
    toggleBlind: async function () {
      await saveSettings(Object.assign({}, settings, { blindMode: !settings.blindMode }), { render: false });
      render();
    },
    exportJSON,
    exportCSV,
    mergeImport,
    replaceImport,
    loadDemo,
    clearDemo,
    clearAll,
    counts: async function () {
      const [trades, templates, shots] = await Promise.all([DB.countTrades(), DB.getAllTemplates(), DB.getAllScreenshots()]);
      return { trades, templates: templates.length, screenshots: shots.length, missedTrades: missedTrades.length };
    },
    storageEstimate: () => DB.getStorageEstimate(),
    authSignIn: async function (email, password) {
      const data = await DB.signIn(email, password);
      state.user = data.user || null;
      await load();
      if (DB.checkLocalDataToMigrate) {
        const check = await DB.checkLocalDataToMigrate();
        if (check.hasData) state.migrationAvailable = check;
      }
      render();
      return data;
    },
    authSignUp: async function (email, password, fullName) {
      const data = await DB.signUp(email, password, fullName);
      state.user = data.user || null;
      await load();
      render();
      return data;
    },
    updateProfile: async function (updates) {
      const res = await DB.updateUserProfile(updates);
      await load();
      render();
      return res;
    },
    authSignOut: async function () {
      await DB.signOut();
      state.user = null;
      state.migrationAvailable = null;
      state.view = "journal";
      rawTrades = [];
      missedTrades = [];
      rebuild();
      render();
    },
    deleteAccount: async function () {
      const res = await DB.deleteUserAccount();
      state.user = null;
      state.migrationAvailable = null;
      state.view = "journal";
      rawTrades = [];
      missedTrades = [];
      rebuild();
      render();
      return res;
    },
    migrateData: async function () {
      const res = await DB.migrateLocalDataToSupabase();
      state.migrationAvailable = null;
      await load();
      render();
      return res;
    },
    assignBatch: async function (ids, batchName) {
      if (!ids || !ids.length || !batchName) return;
      const clean = String(batchName).trim();
      const customBatches = Array.isArray(settings.customBatches) ? settings.customBatches.slice() : [];
      if (!customBatches.includes(clean)) {
        customBatches.push(clean);
        settings.customBatches = customBatches;
        saveSettings(settings, { render: false });
      }
      for (const id of ids) {
        await updateTrade(id, { dataset: clean });
      }
      await load();
      render();
    },
    deleteTrades: async function (ids) {
      if (!ids || !ids.length) return;
      for (const id of ids) {
        await DB.deleteTrade(id);
      }
      await load();
      render();
    },
  };

  async function boot() {
    try {
      if (DB.initSupabase) DB.initSupabase();
      if (DB.checkAuthSession) await DB.checkAuthSession();
      state.user = DB.getUser ? DB.getUser() : null;

      await load();

      if (state.user && DB.checkLocalDataToMigrate) {
        const check = await DB.checkLocalDataToMigrate();
        if (check.hasData) {
          state.migrationAvailable = check;
        }
      }

      initialized = true;
      if (!window.ICT || !window.ICT.ui || typeof window.ICT.ui.init !== "function") {
        throw new Error("UI module failed to initialize. Please check for script errors in ui.js.");
      }
      window.ICT.ui.init(state, handlers);

      let lastLoadedUserId = state.user?.id || null;
      if (DB.onAuthStateChange) {
        DB.onAuthStateChange(async (event, session) => {
          if (event === "TOKEN_REFRESHED") return;
          const nextUserId = session?.user?.id || null;
          if (nextUserId === lastLoadedUserId && event !== "SIGNED_IN" && event !== "SIGNED_OUT") {
            return;
          }
          lastLoadedUserId = nextUserId;
          state.user = session?.user || null;
          if (session?.user) {
            await load();
            if (DB.checkLocalDataToMigrate) {
              const check = await DB.checkLocalDataToMigrate();
              if (check.hasData) {
                state.migrationAvailable = check;
              }
            }
          } else {
            rawTrades = [];
            missedTrades = [];
            state.migrationAvailable = null;
            rebuild();
          }
          render();
        });
      }
    } catch (error) {
      showFatal(error);
    }
  }

  window.ICT = window.ICT || {};
  window.ICT.app = {
    reload: refresh,
    getState: () => state,
    exportJSON,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
