(function (root) {
  "use strict";

  const DB_NAME = "ictBacktestJournal";
  const DB_VERSION = 1;
  const STORES = {
    trades: "trades",
    templates: "templates",
    settings: "settings",
    screenshots: "screenshots",
  };

  const MISSED_STORAGE_KEY = "ict_missed_trades";
  const MISSED_REASONS_KEY = "ict_missed_reasons";
  const DEFAULT_MISSED_REASONS = [
    "Hesitation",
    "Fear of Loss",
    "Missed Alert",
    "HTF Doubt",
    "Away from Desk",
    "News/Spread",
  ];

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isValidUuid(id) {
    return typeof id === "string" && UUID_REGEX.test(id.trim());
  }

  function generateUuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
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

  // ============================================================================
  // SUPABASE CLIENT & AUTH MANAGEMENT
  // ============================================================================

  let supabaseClient = null;
  let currentUser = null;

  function initSupabase() {
    const cfg = root.ICT_CONFIG;
    if (!cfg || !cfg.isConfigured || !cfg.isConfigured()) {
      supabaseClient = null;
      return null;
    }
    const createClientFn = root.supabase?.createClient;
    if (typeof createClientFn === "function") {
      try {
        supabaseClient = createClientFn(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
        return supabaseClient;
      } catch (err) {
        console.warn("Failed to initialize Supabase client:", err);
        supabaseClient = null;
        return null;
      }
    }
    return null;
  }

  function isSupabaseConfigured() {
    return Boolean(root.ICT_CONFIG && root.ICT_CONFIG.isConfigured());
  }

  function isSupabaseActive() {
    if (!supabaseClient) initSupabase();
    return Boolean(supabaseClient && currentUser);
  }

  function getClient() {
    if (!supabaseClient) initSupabase();
    return supabaseClient;
  }

  function getUser() {
    return currentUser;
  }

  async function checkAuthSession() {
    const client = getClient();
    if (!client) return null;
    try {
      const { data, error } = await client.auth.getSession();
      if (error) {
        console.warn("Supabase session check error:", error);
        return null;
      }
      currentUser = data?.session?.user || null;
      return currentUser;
    } catch (err) {
      console.warn("Supabase session check exception:", err);
      return null;
    }
  }

  function onAuthStateChange(callback) {
    const client = getClient();
    if (!client) {
      return { unsubscribe: () => {} };
    }
    const { data: { subscription } } = client.auth.onAuthStateChange(async (event, session) => {
      currentUser = session?.user || null;
      if (typeof callback === "function") {
        await callback(event, session);
      }
    });
    return subscription;
  }

  async function initUserSettings(userId) {
    const client = getClient();
    if (!client || !userId) return;
    try {
      const { data } = await client
        .from("user_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (!data) {
        const defaultSettings = {
          user_id: userId,
          account_balance: 10000,
          default_risk_pct: 1.0,
          visible_columns: [],
          thresholds: {},
          missed_reasons: DEFAULT_MISSED_REASONS.slice(),
          custom_setups: [],
          custom_batches: [],
          theme: "dark",
          imgbb_api_key: root.ICT_CONFIG?.IMGBB_API_KEY || "",
          updated_at: new Date().toISOString(),
        };
        await client.from("user_settings").upsert(defaultSettings);
      }
    } catch (err) {
      console.warn("Could not check/create default user_settings:", err);
    }
  }

  async function signUp(email, password) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured. Please enter your Supabase URL & Anon Key.");
    }
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    currentUser = data.user || null;
    if (currentUser) {
      await initUserSettings(currentUser.id);
    }
    return data;
  }

  async function signIn(email, password) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured. Please enter your Supabase URL & Anon Key.");
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user || null;
    if (currentUser) {
      await initUserSettings(currentUser.id);
    }
    return data;
  }

  async function signOut() {
    const client = getClient();
    if (client) {
      try {
        await client.auth.signOut();
      } catch (err) {
        console.warn("Sign out error:", err);
      }
    }
    currentUser = null;
  }

  // ============================================================================
  // POSTGRESQL <-> FRONTEND FIELD MAPPERS
  // ============================================================================

  function toDbTrade(trade, userId) {
    const A = root.ICT?.analytics || {};
    const toNum = A.toNum || ((v) => (v === null || v === undefined || v === "" || isNaN(v) ? null : Number(v)));
    const planString = A.planString || ((levels) => (Array.isArray(levels) ? levels.map((l) => `${Math.round(l.allocation * 100)}% @ ${l.targetR}R`).join(", ") : ""));
    const finalR = A.finalR || (() => null);

    const finalRVal = trade.finalR !== undefined ? toNum(trade.finalR) : toNum(finalR(trade));
    let status = "INCOMPLETE";
    if (finalRVal !== null && !isNaN(finalRVal)) {
      if (Math.abs(finalRVal) < 1e-9) status = "BE";
      else if (finalRVal > 0) status = "WIN";
      else status = "LOSS";
    } else if (trade.status) {
      const s = String(trade.status).toUpperCase();
      if (["WIN", "LOSS", "BE", "INCOMPLETE"].includes(s)) status = s;
    }

    const dirUpper = String(trade.direction || "LONG").toUpperCase();
    const direction = dirUpper === "SHORT" ? "SHORT" : "LONG";

    let dateISO = new Date().toISOString();
    if (trade.date) {
      try {
        dateISO = new Date(trade.date + (trade.time ? "T" + trade.time : "T00:00:00Z")).toISOString();
      } catch (_) {
        dateISO = new Date().toISOString();
      }
    }

    const htfUrl = trade.htfChartUrl || trade.entryScreenshot || trade.screenshotBefore || (Array.isArray(trade.entryScreenshots) && trade.entryScreenshots[0]) || null;
    const ltfUrl = trade.ltfChartUrl || trade.outcomeScreenshot || trade.screenshotAfter || (Array.isArray(trade.outcomeScreenshots) && trade.outcomeScreenshots[0]) || null;

    const id = trade.id && isValidUuid(trade.id) ? trade.id : generateUuid();

    return {
      id,
      user_id: userId || (currentUser ? currentUser.id : "00000000-0000-0000-0000-000000000000"),
      instrument: trade.instrument || "EURUSD",
      date: dateISO,
      session: trade.session || "",
      direction,
      status,
      result: finalRVal !== null ? finalRVal : 0,
      risk: toNum(trade.riskR) !== null ? toNum(trade.riskR) : 1.0,
      wick_sl: parseRrVal(trade.wickRr),
      body_sl: parseRrVal(trade.bodyRr),
      spc_sl: parseRrVal(trade.spcSl !== undefined && trade.spcSl !== null && trade.spcSl !== "" ? trade.spcSl : trade.spcRr),
      rem_exit_r: trade.remainderExitR !== null && trade.remainderExitR !== undefined ? toNum(trade.remainderExitR) : null,
      exit_plan: trade.exitPlanTemplateName || (Array.isArray(trade.exitPlan) ? planString(trade.exitPlan) : ""),
      partials: Array.isArray(trade.exitPlan) ? trade.exitPlan : [],
      setup: Array.isArray(trade.setup) ? trade.setup.join(" + ") : (trade.setup || ""),
      quality: trade.setupQuality || "",
      batch: trade.dataset || trade.batch || "",
      target_hits: Array.isArray(trade.levelsHitOverride) ? trade.levelsHitOverride : (Array.isArray(trade.levelsHit) ? trade.levelsHit : []),
      mfe: trade.tradePath ? toNum(trade.tradePath.mfe) : (trade.mfe !== undefined ? toNum(trade.mfe) : null),
      mae: trade.tradePath ? toNum(trade.tradePath.mae) : (trade.mae !== undefined ? toNum(trade.mae) : null),
      entry_price: toNum(trade.entry),
      stop_price: toNum(trade.stopLoss),
      tp_price: toNum(trade.tpPrice || trade.tp),
      htf_chart_url: htfUrl,
      ltf_chart_url: ltfUrl,
      notes: trade.notes || "",
      extra_data: {
        tradeNumber: trade.tradeNumber,
        time: trade.time || "",
        killzone: trade.killzone || "",
        htfBias: trade.htfBias || "",
        htfTimeframe: trade.htfTimeframe || "",
        entryTimeframe: trade.entryTimeframe || "",
        exitPlanTemplateId: trade.exitPlanTemplateId || null,
        exitPlanTemplateName: trade.exitPlanTemplateName || "",
        tradePath: trade.tradePath || null,
        levelsHitOverride: trade.levelsHitOverride || null,
        finalROverride: trade.finalROverride !== undefined ? trade.finalROverride : null,
        exitReason: trade.exitReason || null,
        entryScreenshots: Array.isArray(trade.entryScreenshots) ? trade.entryScreenshots : (htfUrl ? [htfUrl] : []),
        outcomeScreenshots: Array.isArray(trade.outcomeScreenshots) ? trade.outcomeScreenshots : (ltfUrl ? [ltfUrl] : []),
        wickRr: trade.wickRr,
        bodyRr: trade.bodyRr,
        spcSl: trade.spcSl,
        isDemo: Boolean(trade.isDemo),
        isCopy: Boolean(trade.isCopy),
        legacyId: trade.id,
      },
      updated_at: new Date().toISOString(),
    };
  }

  function fromDbTrade(row) {
    if (!row) return null;
    const extra = (row.extra_data && typeof row.extra_data === "object") ? row.extra_data : {};
    const htfUrl = row.htf_chart_url || extra.entryScreenshot || extra.screenshotBefore || null;
    const ltfUrl = row.ltf_chart_url || extra.outcomeScreenshot || extra.screenshotAfter || null;
    const entryScreenshots = Array.isArray(extra.entryScreenshots) && extra.entryScreenshots.length 
      ? extra.entryScreenshots 
      : (htfUrl ? [htfUrl] : []);
    const outcomeScreenshots = Array.isArray(extra.outcomeScreenshots) && extra.outcomeScreenshots.length 
      ? extra.outcomeScreenshots 
      : (ltfUrl ? [ltfUrl] : []);

    let dateStr = "";
    if (row.date) {
      try {
        dateStr = new Date(row.date).toISOString().slice(0, 10);
      } catch (_) {
        dateStr = String(row.date).slice(0, 10);
      }
    }

    const dirUpper = String(row.direction || "LONG").toUpperCase();
    const direction = dirUpper === "SHORT" ? "Short" : "Long";

    return {
      id: row.id,
      tradeNumber: extra.tradeNumber !== undefined ? extra.tradeNumber : null,
      date: dateStr,
      time: extra.time || "",
      session: row.session || "",
      killzone: extra.killzone || "",
      instrument: row.instrument || "",
      direction,
      htfBias: extra.htfBias || "",
      htfTimeframe: extra.htfTimeframe || "",
      entryTimeframe: extra.entryTimeframe || "",
      setup: row.setup || "",
      setupQuality: row.quality || "",
      entry: row.entry_price !== null && row.entry_price !== undefined ? Number(row.entry_price) : null,
      stopLoss: row.stop_price !== null && row.stop_price !== undefined ? Number(row.stop_price) : null,
      wickRr: row.wick_sl !== null && row.wick_sl !== undefined ? Number(row.wick_sl) : (extra.wickRr || null),
      bodyRr: row.body_sl !== null && row.body_sl !== undefined ? Number(row.body_sl) : (extra.bodyRr || null),
      spcSl: row.spc_sl !== null && row.spc_sl !== undefined ? Number(row.spc_sl) : (extra.spcSl || null),
      riskR: row.risk !== null && row.risk !== undefined ? Number(row.risk) : 1.0,
      exitPlan: Array.isArray(row.partials) ? row.partials : [],
      exitPlanTemplateId: extra.exitPlanTemplateId || null,
      exitPlanTemplateName: row.exit_plan || extra.exitPlanTemplateName || "",
      tradePath: {
        mfe: row.mfe !== null && row.mfe !== undefined ? Number(row.mfe) : (extra.tradePath?.mfe ?? null),
        mae: row.mae !== null && row.mae !== undefined ? Number(row.mae) : (extra.tradePath?.mae ?? null),
        pathComplete: Boolean(extra.tradePath?.pathComplete),
        waypoints: Array.isArray(extra.tradePath?.waypoints) ? extra.tradePath.waypoints : null,
      },
      remainderExitR: row.rem_exit_r !== null && row.rem_exit_r !== undefined ? Number(row.rem_exit_r) : (extra.remainderExitR ?? null),
      levelsHitOverride: Array.isArray(row.target_hits) && row.target_hits.length ? row.target_hits : (extra.levelsHitOverride || null),
      finalROverride: extra.finalROverride !== undefined ? extra.finalROverride : null,
      exitReason: extra.exitReason || null,
      screenshotBefore: htfUrl,
      screenshotAfter: ltfUrl,
      entryScreenshot: htfUrl,
      outcomeScreenshot: ltfUrl,
      htfChartUrl: htfUrl,
      ltfChartUrl: ltfUrl,
      entryScreenshots,
      outcomeScreenshots,
      notes: row.notes || "",
      dataset: row.batch || extra.dataset || "",
      isDemo: Boolean(extra.isDemo),
      isCopy: Boolean(extra.isCopy),
      status: row.status === "INCOMPLETE" ? "incomplete" : "completed",
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString(),
    };
  }

  function toDbMissedTrade(trade, userId) {
    const A = root.ICT?.analytics || {};
    const toNum = A.toNum || ((v) => (v === null || v === undefined || v === "" || isNaN(v) ? null : Number(v)));

    let dateISO = new Date().toISOString();
    if (trade.date) {
      try {
        dateISO = new Date(trade.date + "T00:00:00Z").toISOString();
      } catch (_) {
        dateISO = new Date().toISOString();
      }
    }
    const dirUpper = String(trade.direction || "LONG").toUpperCase();
    const direction = dirUpper === "SHORT" ? "SHORT" : "LONG";

    return {
      id: trade.id && isValidUuid(trade.id) ? trade.id : generateUuid(),
      user_id: userId || (currentUser ? currentUser.id : "00000000-0000-0000-0000-000000000000"),
      date: dateISO,
      instrument: trade.instrument || "EURUSD",
      session: trade.session || "",
      direction,
      potential_r: toNum(trade.potentialR) !== null ? toNum(trade.potentialR) : 0,
      reason: trade.reason ? String(trade.reason).trim() : "Hesitation",
      setup: trade.setup || "",
      batch: trade.batch || trade.dataset || "",
      notes: trade.notes ? String(trade.notes).trim() : "",
      htf_chart_url: trade.htfChartUrl || trade.htfScreenshot || null,
      ltf_chart_url: trade.ltfChartUrl || trade.ltfScreenshot || null,
      updated_at: new Date().toISOString(),
    };
  }

  function fromDbMissedTrade(row) {
    if (!row) return null;
    let dateStr = "";
    if (row.date) {
      try {
        dateStr = new Date(row.date).toISOString().slice(0, 10);
      } catch (_) {
        dateStr = String(row.date).slice(0, 10);
      }
    }
    const dirUpper = String(row.direction || "LONG").toUpperCase();
    const direction = dirUpper === "SHORT" ? "Short" : "Long";

    return {
      id: row.id,
      date: dateStr,
      instrument: row.instrument || "",
      session: row.session || "",
      direction,
      potentialR: Number(row.potential_r || 0),
      reason: row.reason || "Hesitation",
      setup: row.setup || "",
      batch: row.batch || "",
      notes: row.notes || "",
      htfScreenshot: row.htf_chart_url || null,
      ltfScreenshot: row.ltf_chart_url || null,
      htfChartUrl: row.htf_chart_url || null,
      ltfChartUrl: row.ltf_chart_url || null,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString(),
    };
  }

  function toDbExitPlan(template, userId) {
    const A = root.ICT?.analytics || {};
    const planString = A.planString || ((levels) => (Array.isArray(levels) ? levels.map((l) => `${Math.round(l.allocation * 100)}% @ ${l.targetR}R`).join(", ") : ""));

    return {
      id: template.id && isValidUuid(template.id) ? template.id : generateUuid(),
      user_id: userId || (currentUser ? currentUser.id : "00000000-0000-0000-0000-000000000000"),
      name: template.name || "Untitled Plan",
      plan_string: template.description || (template.levels ? planString(template.levels) : ""),
      tiers: Array.isArray(template.levels) ? template.levels : [],
      is_default: Boolean(template.isDefault),
    };
  }

  function fromDbExitPlan(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name || "",
      description: row.plan_string || "",
      levels: Array.isArray(row.tiers) ? row.tiers : [],
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at || new Date().toISOString(),
    };
  }

  function toDbUserSettings(settings, userId) {
    return {
      user_id: userId || (currentUser ? currentUser.id : "00000000-0000-0000-0000-000000000000"),
      account_balance: settings.accountBalance !== undefined ? Number(settings.accountBalance) : 10000,
      default_risk_pct: settings.defaultRiskPct !== undefined ? Number(settings.defaultRiskPct) : 1.0,
      visible_columns: Array.isArray(settings.columns) ? settings.columns : [],
      thresholds: settings.thresholds || {},
      missed_reasons: Array.isArray(settings.missedReasons) ? settings.missedReasons : DEFAULT_MISSED_REASONS.slice(),
      custom_setups: Array.isArray(settings.customSetups) ? settings.customSetups : [],
      custom_batches: Array.isArray(settings.customBatches) ? settings.customBatches : [],
      theme: settings.theme || "dark",
      imgbb_api_key: settings.imgbbApiKey || root.ICT_CONFIG?.IMGBB_API_KEY || "",
      updated_at: new Date().toISOString(),
    };
  }

  function fromDbUserSettings(row) {
    if (!row) return null;
    return {
      accountBalance: row.account_balance !== null ? Number(row.account_balance) : 10000,
      defaultRiskPct: row.default_risk_pct !== null ? Number(row.default_risk_pct) : 1.0,
      columns: Array.isArray(row.visible_columns) ? row.visible_columns : null,
      thresholds: row.thresholds || null,
      missedReasons: Array.isArray(row.missed_reasons) ? row.missed_reasons : null,
      customSetups: Array.isArray(row.custom_setups) ? row.custom_setups : [],
      customBatches: Array.isArray(row.custom_batches) ? row.custom_batches : [],
      theme: row.theme || "dark",
      imgbbApiKey: row.imgbb_api_key || "",
    };
  }

  // ============================================================================
  // INDEXEDDB / LOCAL STORAGE FALLBACK IMPLEMENTATION
  // ============================================================================

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this browser."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.trades)) {
          const trades = db.createObjectStore(STORES.trades, { keyPath: "id" });
          trades.createIndex("date", "date", { unique: false });
          trades.createIndex("instrument", "instrument", { unique: false });
          trades.createIndex("session", "session", { unique: false });
          trades.createIndex("status", "status", { unique: false });
          trades.createIndex("dataset", "dataset", { unique: false });
          trades.createIndex("tradeNumber", "tradeNumber", { unique: false });
          trades.createIndex("isDemo", "isDemo", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.templates)) {
          const templates = db.createObjectStore(STORES.templates, { keyPath: "id" });
          templates.createIndex("name", "name", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.settings)) {
          db.createObjectStore(STORES.settings, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORES.screenshots)) {
          const shots = db.createObjectStore(STORES.screenshots, { keyPath: "id" });
          shots.createIndex("tradeId", "tradeId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open the journal database."));
      request.onblocked = () => reject(new Error("The journal database is blocked by another open tab."));
    });
    return dbPromise;
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Database transaction aborted."));
    });
  }

  async function getAll(storeName) {
    const db = await open();
    const tx = db.transaction(storeName, "readonly");
    const result = await requestPromise(tx.objectStore(storeName).getAll());
    await transactionDone(tx);
    return result;
  }

  async function get(storeName, id) {
    const db = await open();
    const tx = db.transaction(storeName, "readonly");
    const result = await requestPromise(tx.objectStore(storeName).get(id));
    await transactionDone(tx);
    return result || null;
  }

  async function put(storeName, value) {
    const db = await open();
    const tx = db.transaction(storeName, "readwrite");
    const result = await requestPromise(tx.objectStore(storeName).put(value));
    await transactionDone(tx);
    return result;
  }

  async function remove(storeName, id) {
    const db = await open();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    await transactionDone(tx);
  }

  function rowsToObject(rows) {
    const obj = {};
    rows.forEach((row) => {
      if (row && row.key !== undefined) obj[row.key] = row.value;
    });
    return obj;
  }

  // ============================================================================
  // UNIFIED CRUD OPERATIONS (SUPABASE WITH LOCAL FALLBACK)
  // ============================================================================

  async function getAllTrades() {
    if (isSupabaseActive()) {
      const client = getClient();
      const { data, error } = await client
        .from("trades")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return (data || []).map(fromDbTrade).sort((a, b) => (a.tradeNumber || 0) - (b.tradeNumber || 0));
    }
    const trades = await getAll(STORES.trades);
    return trades.sort((a, b) => (a.tradeNumber || 0) - (b.tradeNumber || 0));
  }

  async function putTrade(trade) {
    if (isSupabaseActive()) {
      const client = getClient();
      const row = toDbTrade(trade, currentUser.id);
      const { data, error } = await client
        .from("trades")
        .upsert(row)
        .select();
      if (error) throw error;
      return data && data[0] ? fromDbTrade(data[0]) : trade;
    }
    return put(STORES.trades, trade);
  }

  async function putTrades(trades) {
    if (!trades || !trades.length) return 0;
    if (isSupabaseActive()) {
      const client = getClient();
      const rows = trades.map((t) => toDbTrade(t, currentUser.id));
      const { error } = await client.from("trades").upsert(rows);
      if (error) throw error;
      return rows.length;
    }
    const db = await open();
    const tx = db.transaction(STORES.trades, "readwrite");
    const store = tx.objectStore(STORES.trades);
    trades.forEach((trade) => store.put(trade));
    await transactionDone(tx);
    return trades.length;
  }

  async function deleteTrade(id) {
    if (isSupabaseActive()) {
      const client = getClient();
      const { error } = await client.from("trades").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    return remove(STORES.trades, id);
  }

  async function deleteDemoTrades() {
    if (isSupabaseActive()) {
      const client = getClient();
      const all = await getAllTrades();
      const demoIds = all.filter((t) => t.isDemo).map((t) => t.id);
      if (!demoIds.length) return 0;
      const { error } = await client.from("trades").delete().in("id", demoIds);
      if (error) throw error;
      return demoIds.length;
    }
    const db = await open();
    const tx = db.transaction(STORES.trades, "readwrite");
    const store = tx.objectStore(STORES.trades);
    const request = store.openCursor();
    let removed = 0;
    await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (cursor.value && cursor.value.isDemo) {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    await transactionDone(tx);
    return removed;
  }

  async function countTrades() {
    if (isSupabaseActive()) {
      const client = getClient();
      const { count, error } = await client
        .from("trades")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    }
    const db = await open();
    const tx = db.transaction(STORES.trades, "readonly");
    const count = await requestPromise(tx.objectStore(STORES.trades).count());
    await transactionDone(tx);
    return count;
  }

  async function getAllTemplates() {
    if (isSupabaseActive()) {
      const client = getClient();
      const { data, error } = await client
        .from("exit_plans")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []).map(fromDbExitPlan);
    }
    return getAll(STORES.templates);
  }

  async function putTemplate(template) {
    if (isSupabaseActive()) {
      const client = getClient();
      const row = toDbExitPlan(template, currentUser.id);
      const { data, error } = await client.from("exit_plans").upsert(row).select();
      if (error) throw error;
      return data && data[0] ? fromDbExitPlan(data[0]) : template;
    }
    return put(STORES.templates, template);
  }

  async function putTemplates(templates) {
    if (!templates || !templates.length) return 0;
    if (isSupabaseActive()) {
      const client = getClient();
      const rows = templates.map((t) => toDbExitPlan(t, currentUser.id));
      const { error } = await client.from("exit_plans").upsert(rows);
      if (error) throw error;
      return templates.length;
    }
    const db = await open();
    const tx = db.transaction(STORES.templates, "readwrite");
    const store = tx.objectStore(STORES.templates);
    templates.forEach((template) => store.put(template));
    await transactionDone(tx);
    return templates.length;
  }

  async function deleteTemplate(id) {
    if (isSupabaseActive()) {
      const client = getClient();
      const { error } = await client.from("exit_plans").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    return remove(STORES.templates, id);
  }

  async function countTemplatesForTrade(id) {
    const trades = await getAllTrades();
    return trades.filter((t) => t.exitPlanTemplateId === id).length;
  }

  async function getAllSettings() {
    if (isSupabaseActive()) {
      const client = getClient();
      const { data, error } = await client
        .from("user_settings")
        .select("*")
        .eq("user_id", currentUser.id)
        .maybeSingle();
      if (error) throw error;
      if (data) return fromDbUserSettings(data);
      return {};
    }
    return rowsToObject(await getAll(STORES.settings));
  }

  async function setSettings(newSettings) {
    if (isSupabaseActive()) {
      const client = getClient();
      const row = toDbUserSettings(newSettings, currentUser.id);
      const { error } = await client.from("user_settings").upsert(row);
      if (error) throw error;
      return newSettings;
    }
    const db = await open();
    const tx = db.transaction(STORES.settings, "readwrite");
    const store = tx.objectStore(STORES.settings);
    Object.keys(newSettings || {}).forEach((key) => {
      store.put({ key, value: newSettings[key] });
    });
    await transactionDone(tx);
    return newSettings;
  }

  async function setSetting(key, value) {
    if (isSupabaseActive()) {
      const current = await getAllSettings();
      current[key] = value;
      return setSettings(current);
    }
    return put(STORES.settings, { key, value });
  }

  async function deleteSetting(key) {
    if (isSupabaseActive()) {
      const current = await getAllSettings();
      delete current[key];
      return setSettings(current);
    }
    return remove(STORES.settings, key);
  }

  // Missed Trades CRUD
  async function getMissedTrades() {
    if (isSupabaseActive()) {
      const client = getClient();
      const { data, error } = await client
        .from("missed_trades")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return (data || []).map(fromDbMissedTrade);
    }
    try {
      if (typeof localStorage === "undefined") return [];
      const raw = localStorage.getItem(MISSED_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  async function saveMissedTrades(trades) {
    if (isSupabaseActive()) {
      if (!trades || !trades.length) return;
      const client = getClient();
      const rows = trades.map((m) => toDbMissedTrade(m, currentUser.id));
      const { error } = await client.from("missed_trades").upsert(rows);
      if (error) throw error;
      return;
    }
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(MISSED_STORAGE_KEY, JSON.stringify(Array.isArray(trades) ? trades : []));
    } catch (e) {
      console.warn("Could not persist missed trades to localStorage:", e);
    }
  }

  async function putMissedTrade(trade) {
    if (isSupabaseActive()) {
      const client = getClient();
      const row = toDbMissedTrade(trade, currentUser.id);
      const { data, error } = await client.from("missed_trades").upsert(row).select();
      if (error) throw error;
      return data && data[0] ? fromDbMissedTrade(data[0]) : trade;
    }
    const current = await getMissedTrades();
    const idx = current.findIndex((m) => String(m.id) === String(trade.id));
    if (idx >= 0) current[idx] = trade;
    else current.unshift(trade);
    await saveMissedTrades(current);
    return trade;
  }

  async function deleteMissedTrade(id) {
    if (isSupabaseActive()) {
      const client = getClient();
      const { error } = await client.from("missed_trades").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const current = await getMissedTrades();
    const filtered = current.filter((m) => String(m.id) !== String(id));
    await saveMissedTrades(filtered);
  }

  async function getMissedReasons() {
    if (isSupabaseActive()) {
      const settings = await getAllSettings();
      if (Array.isArray(settings.missedReasons) && settings.missedReasons.length) {
        return settings.missedReasons;
      }
    }
    try {
      if (typeof localStorage === "undefined") return DEFAULT_MISSED_REASONS.slice();
      const raw = localStorage.getItem(MISSED_REASONS_KEY);
      if (!raw) return DEFAULT_MISSED_REASONS.slice();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_MISSED_REASONS.slice();
    } catch (_) {
      return DEFAULT_MISSED_REASONS.slice();
    }
  }

  async function saveMissedReasons(reasons) {
    if (isSupabaseActive()) {
      await setSetting("missedReasons", reasons);
      return;
    }
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(MISSED_REASONS_KEY, JSON.stringify(Array.isArray(reasons) ? reasons : []));
    } catch (e) {
      console.warn("Could not persist missed reasons to localStorage:", e);
    }
  }

  // Screenshot store (legacy / offline)
  async function putScreenshot(shot) {
    return put(STORES.screenshots, shot);
  }

  async function getScreenshot(id) {
    return get(STORES.screenshots, id);
  }

  async function getAllScreenshots() {
    return getAll(STORES.screenshots);
  }

  async function deleteScreenshot(id) {
    return remove(STORES.screenshots, id);
  }

  async function deleteScreenshots(ids) {
    if (!ids || !ids.length) return 0;
    const db = await open();
    const tx = db.transaction(STORES.screenshots, "readwrite");
    const store = tx.objectStore(STORES.screenshots);
    ids.forEach((id) => store.delete(id));
    await transactionDone(tx);
    return ids.length;
  }

  // ============================================================================
  // BACKUP, IMPORT, EXPORT & DEMO DATA
  // ============================================================================

  async function exportAll() {
    if (isSupabaseActive()) {
      const [trades, templates, settings, missedTrades, missedReasons] = await Promise.all([
        getAllTrades(),
        getAllTemplates(),
        getAllSettings(),
        getMissedTrades(),
        getMissedReasons(),
      ]);
      return {
        formatVersion: 2,
        app: "ICT Backtest Journal",
        exportedAt: new Date().toISOString(),
        source: "supabase",
        user: currentUser ? currentUser.email : null,
        trades,
        templates,
        settings,
        missedTrades,
        missedReasons,
      };
    }

    const [trades, templates, settingsRows, screenshots] = await Promise.all([
      getAllTrades(),
      getAllTemplates(),
      getAll(STORES.settings),
      getAllScreenshots(),
    ]);
    return {
      formatVersion: 1,
      app: "ICT Backtest Journal",
      exportedAt: new Date().toISOString(),
      trades,
      templates,
      settings: rowsToObject(settingsRows),
      screenshots,
      missedTrades: await getMissedTrades(),
      missedReasons: await getMissedReasons(),
    };
  }

  async function replaceAll(payload) {
    if (isSupabaseActive()) {
      const client = getClient();
      if (payload.trades && Array.isArray(payload.trades)) {
        await client.from("trades").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        const rows = payload.trades.map((t) => toDbTrade(t, currentUser.id));
        if (rows.length) await client.from("trades").insert(rows);
      }
      if (payload.missedTrades && Array.isArray(payload.missedTrades)) {
        await client.from("missed_trades").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        const rows = payload.missedTrades.map((m) => toDbMissedTrade(m, currentUser.id));
        if (rows.length) await client.from("missed_trades").insert(rows);
      }
      if (payload.templates && Array.isArray(payload.templates)) {
        await client.from("exit_plans").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        const rows = payload.templates.map((tpl) => toDbExitPlan(tpl, currentUser.id));
        if (rows.length) await client.from("exit_plans").insert(rows);
      }
      if (payload.settings) {
        await setSettings(payload.settings);
      }
      if (payload.missedReasons && Array.isArray(payload.missedReasons)) {
        await saveMissedReasons(payload.missedReasons);
      }
      return {
        trades: (payload.trades || []).length,
        templates: (payload.templates || []).length,
        missedTrades: (payload.missedTrades || []).length,
        missedReasons: (payload.missedReasons || []).length,
      };
    }

    const db = await open();
    const tx = db.transaction(
      [STORES.trades, STORES.templates, STORES.settings, STORES.screenshots],
      "readwrite"
    );
    tx.objectStore(STORES.trades).clear();
    tx.objectStore(STORES.templates).clear();
    tx.objectStore(STORES.settings).clear();
    tx.objectStore(STORES.screenshots).clear();
    (payload.trades || []).forEach((t) => tx.objectStore(STORES.trades).put(t));
    (payload.templates || []).forEach((t) => tx.objectStore(STORES.templates).put(t));
    Object.keys(payload.settings || {}).forEach((key) =>
      tx.objectStore(STORES.settings).put({ key, value: payload.settings[key] })
    );
    (payload.screenshots || []).forEach((s) => tx.objectStore(STORES.screenshots).put(s));
    await transactionDone(tx);
    if (payload.missedTrades && Array.isArray(payload.missedTrades)) {
      await saveMissedTrades(payload.missedTrades);
    }
    if (payload.missedReasons && Array.isArray(payload.missedReasons)) {
      await saveMissedReasons(payload.missedReasons);
    }
    return {
      trades: (payload.trades || []).length,
      templates: (payload.templates || []).length,
      screenshots: (payload.screenshots || []).length,
      missedTrades: (payload.missedTrades || []).length,
      missedReasons: (payload.missedReasons || []).length,
    };
  }

  async function mergeAll(payload, options) {
    if (isSupabaseActive()) {
      let addedTrades = 0;
      if (payload.trades && Array.isArray(payload.trades)) {
        await putTrades(payload.trades);
        addedTrades = payload.trades.length;
      }
      if (payload.missedTrades && Array.isArray(payload.missedTrades)) {
        await saveMissedTrades(payload.missedTrades);
      }
      if (payload.templates && Array.isArray(payload.templates)) {
        await putTemplates(payload.templates);
      }
      if (payload.missedReasons && Array.isArray(payload.missedReasons)) {
        const cur = await getMissedReasons();
        const merged = Array.from(new Set([...cur, ...payload.missedReasons]));
        await saveMissedReasons(merged);
      }
      return {
        addedTrades,
        missedTrades: (payload.missedTrades || []).length,
        missedReasons: (payload.missedReasons || []).length,
      };
    }

    const opts = options || {};
    const db = await open();
    const tx = db.transaction(
      [STORES.trades, STORES.templates, STORES.settings, STORES.screenshots],
      "readwrite"
    );
    const tradeStore = tx.objectStore(STORES.trades);
    const existingTrades = await requestPromise(tradeStore.getAll());
    const existingTradeIds = new Set(existingTrades.map((t) => String(t.id)));

    let addedTrades = 0;
    let updatedTrades = 0;
    let skippedTrades = 0;

    (payload.trades || []).forEach((trade) => {
      const exists = existingTradeIds.has(String(trade.id));
      if (exists && !opts.updateExisting) {
        skippedTrades += 1;
        return;
      }
      tradeStore.put(trade);
      if (exists) updatedTrades += 1;
      else addedTrades += 1;
    });

    const tplStore = tx.objectStore(STORES.templates);
    const existingTpls = await requestPromise(tplStore.getAll());
    const existingTplIds = new Set(existingTpls.map((t) => String(t.id)));
    let addedTemplates = 0;
    let updatedTemplates = 0;
    let skippedTemplates = 0;

    (payload.templates || []).forEach((tpl) => {
      const exists = existingTplIds.has(String(tpl.id));
      if (exists && !opts.updateExisting) {
        skippedTemplates += 1;
        return;
      }
      tplStore.put(tpl);
      if (exists) updatedTemplates += 1;
      else addedTemplates += 1;
    });

    if (payload.settings) {
      const settingsStore = tx.objectStore(STORES.settings);
      Object.keys(payload.settings).forEach((key) => {
        settingsStore.put({ key, value: payload.settings[key] });
      });
    }

    if (payload.screenshots && Array.isArray(payload.screenshots)) {
      const shotStore = tx.objectStore(STORES.screenshots);
      payload.screenshots.forEach((shot) => shotStore.put(shot));
    }

    await transactionDone(tx);

    let addedMissed = 0;
    let updatedMissed = 0;
    if (payload.missedTrades && Array.isArray(payload.missedTrades)) {
      const existingMissed = await getMissedTrades();
      const existingIds = new Set(existingMissed.map((m) => String(m.id)));
      for (const m of payload.missedTrades) {
        const exists = existingIds.has(String(m.id));
        if (exists && !opts.updateExisting) continue;
        if (exists) {
          const idx = existingMissed.findIndex((item) => String(item.id) === String(m.id));
          if (idx >= 0) existingMissed[idx] = m;
          updatedMissed += 1;
        } else {
          existingMissed.push(m);
          existingIds.add(String(m.id));
          addedMissed += 1;
        }
      }
      await saveMissedTrades(existingMissed);
    }

    if (payload.missedReasons && Array.isArray(payload.missedReasons)) {
      const currentReasons = await getMissedReasons();
      const mergedReasons = Array.from(new Set([...currentReasons, ...payload.missedReasons]));
      await saveMissedReasons(mergedReasons);
    }

    return {
      addedTrades,
      updatedTrades,
      skippedTrades,
      addedTemplates,
      updatedTemplates,
      skippedTemplates,
      screenshots: (payload.screenshots || []).length,
      missedTrades: (payload.missedTrades || []).length,
      missedReasons: (payload.missedReasons || []).length,
    };
  }

  async function insertDemoTrades(userId) {
    const uid = userId || (currentUser ? currentUser.id : null);
    const demos = root.ICT?.analytics?.generateDemoTrades(6) || [];
    if (isSupabaseActive() && uid) {
      const client = getClient();
      const rows = demos.map((t) => toDbTrade(t, uid));
      const { error } = await client.from("trades").insert(rows);
      if (error) throw error;
      return demos;
    }
    await putTrades(demos);
    return demos;
  }

  // ============================================================================
  // LOCAL TO SUPABASE MIGRATION HELPERS
  // ============================================================================

  async function checkLocalDataToMigrate() {
    let localTrades = [];
    try {
      const db = await open();
      const tx = db.transaction(STORES.trades, "readonly");
      localTrades = await requestPromise(tx.objectStore(STORES.trades).getAll());
    } catch (_) {}

    let localMissed = [];
    try {
      const raw = localStorage.getItem(MISSED_STORAGE_KEY);
      if (raw) localMissed = JSON.parse(raw);
    } catch (_) {}

    return {
      tradesCount: (localTrades || []).length,
      missedCount: (localMissed || []).length,
      hasData: (localTrades && localTrades.length > 0) || (localMissed && localMissed.length > 0),
    };
  }

  async function migrateLocalDataToSupabase() {
    if (!isSupabaseActive()) {
      throw new Error("Supabase is not active or user is not signed in.");
    }

    const client = getClient();
    let localTrades = [];
    let localTemplates = [];
    let localSettings = {};
    try {
      const db = await open();
      const tx1 = db.transaction(STORES.trades, "readonly");
      localTrades = await requestPromise(tx1.objectStore(STORES.trades).getAll());
      const tx2 = db.transaction(STORES.templates, "readonly");
      localTemplates = await requestPromise(tx2.objectStore(STORES.templates).getAll());
      const tx3 = db.transaction(STORES.settings, "readonly");
      const sRows = await requestPromise(tx3.objectStore(STORES.settings).getAll());
      localSettings = rowsToObject(sRows);
    } catch (_) {}

    let localMissed = [];
    try {
      const raw = localStorage.getItem(MISSED_STORAGE_KEY);
      if (raw) localMissed = JSON.parse(raw);
    } catch (_) {}

    let tradesUploaded = 0;
    if (localTrades.length) {
      const rows = localTrades.map((t) => toDbTrade(t, currentUser.id));
      const { error } = await client.from("trades").upsert(rows);
      if (error) throw error;
      tradesUploaded = rows.length;
    }

    let missedUploaded = 0;
    if (localMissed.length) {
      const rows = localMissed.map((m) => toDbMissedTrade(m, currentUser.id));
      const { error } = await client.from("missed_trades").upsert(rows);
      if (error) throw error;
      missedUploaded = rows.length;
    }

    if (localTemplates.length) {
      const rows = localTemplates.map((tpl) => toDbExitPlan(tpl, currentUser.id));
      await client.from("exit_plans").upsert(rows);
    }

    if (localSettings && Object.keys(localSettings).length) {
      await setSettings(localSettings);
    }

    return {
      tradesUploaded,
      missedUploaded,
    };
  }

  async function clearAllData() {
    if (isSupabaseActive()) {
      const client = getClient();
      await client.from("trades").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await client.from("missed_trades").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      return;
    }
    const db = await open();
    const tx = db.transaction(
      [STORES.trades, STORES.templates, STORES.settings, STORES.screenshots],
      "readwrite"
    );
    Object.values(STORES).forEach((name) => tx.objectStore(name).clear());
    await transactionDone(tx);
  }

  async function clearTradesOnly() {
    if (isSupabaseActive()) {
      const client = getClient();
      await client.from("trades").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      return;
    }
    const db = await open();
    const tx = db.transaction(STORES.trades, "readwrite");
    tx.objectStore(STORES.trades).clear();
    await transactionDone(tx);
  }

  async function clearTradeData() {
    if (isSupabaseActive()) {
      const client = getClient();
      await client.from("trades").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      return;
    }
    const db = await open();
    const tx = db.transaction([STORES.trades, STORES.screenshots], "readwrite");
    tx.objectStore(STORES.trades).clear();
    tx.objectStore(STORES.screenshots).clear();
    await transactionDone(tx);
  }

  async function getStorageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        return await navigator.storage.estimate();
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  root.ICT = root.ICT || {};
  root.ICT.db = {
    DB_NAME,
    DB_VERSION,
    STORES,
    open,
    initSupabase,
    isSupabaseConfigured,
    isSupabaseActive,
    getClient,
    getUser,
    checkAuthSession,
    onAuthStateChange,
    signUp,
    signIn,
    signOut,
    toDbTrade,
    fromDbTrade,
    toDbMissedTrade,
    fromDbMissedTrade,
    toDbExitPlan,
    fromDbExitPlan,
    toDbUserSettings,
    fromDbUserSettings,
    getAllTrades,
    putTrade,
    putTrades,
    deleteTrade,
    deleteDemoTrades,
    countTrades,
    getAllTemplates,
    putTemplate,
    putTemplates,
    deleteTemplate,
    countTemplatesForTrade,
    getAllSettings,
    setSettings,
    setSetting,
    deleteSetting,
    putScreenshot,
    getScreenshot,
    getAllScreenshots,
    deleteScreenshot,
    deleteScreenshots,
    exportAll,
    replaceAll,
    mergeAll,
    clearAllData,
    clearTradesOnly,
    clearTradeData,
    getStorageEstimate,
    getMissedTrades,
    saveMissedTrades,
    putMissedTrade,
    deleteMissedTrade,
    getMissedReasons,
    saveMissedReasons,
    insertDemoTrades,
    checkLocalDataToMigrate,
    migrateLocalDataToSupabase,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
