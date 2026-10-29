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

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this browser. Use a modern browser or a local server."));
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

  async function getAllTrades() {
    const trades = await getAll(STORES.trades);
    return trades.sort((a, b) => (a.tradeNumber || 0) - (b.tradeNumber || 0));
  }

  async function putTrade(trade) {
    return put(STORES.trades, trade);
  }

  async function putTrades(trades) {
    if (!trades || !trades.length) return 0;
    const db = await open();
    const tx = db.transaction(STORES.trades, "readwrite");
    const store = tx.objectStore(STORES.trades);
    trades.forEach((trade) => store.put(trade));
    await transactionDone(tx);
    return trades.length;
  }

  async function deleteTrade(id) {
    return remove(STORES.trades, id);
  }

  async function deleteDemoTrades() {
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
    const db = await open();
    const tx = db.transaction(STORES.trades, "readonly");
    const count = await requestPromise(tx.objectStore(STORES.trades).count());
    await transactionDone(tx);
    return count;
  }

  async function getAllTemplates() {
    return getAll(STORES.templates);
  }

  async function putTemplate(template) {
    return put(STORES.templates, template);
  }

  async function putTemplates(templates) {
    if (!templates || !templates.length) return 0;
    const db = await open();
    const tx = db.transaction(STORES.templates, "readwrite");
    const store = tx.objectStore(STORES.templates);
    templates.forEach((template) => store.put(template));
    await transactionDone(tx);
    return templates.length;
  }

  async function deleteTemplate(id) {
    return remove(STORES.templates, id);
  }

  async function countTemplatesForTrade(id) {
    const trades = await getAllTrades();
    return trades.filter((t) => t.exitPlanTemplateId === id).length;
  }

  function rowsToObject(rows) {
    const obj = {};
    rows.forEach((row) => {
      if (row && row.key !== undefined) obj[row.key] = row.value;
    });
    return obj;
  }

  async function getAllSettings() {
    return rowsToObject(await getAll(STORES.settings));
  }

  async function setSettings(settings) {
    const db = await open();
    const tx = db.transaction(STORES.settings, "readwrite");
    const store = tx.objectStore(STORES.settings);
    Object.keys(settings || {}).forEach((key) => {
      store.put({ key, value: settings[key] });
    });
    await transactionDone(tx);
    return settings;
  }

  async function setSetting(key, value) {
    return put(STORES.settings, { key, value });
  }

  async function deleteSetting(key) {
    return remove(STORES.settings, key);
  }

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

  async function exportAll() {
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
    };
  }

  async function replaceAll(payload) {
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
    return {
      trades: (payload.trades || []).length,
      templates: (payload.templates || []).length,
      screenshots: (payload.screenshots || []).length,
    };
  }

  async function mergeAll(payload, options) {
    const opts = options || {};
    const db = await open();
    const tx = db.transaction(
      [STORES.trades, STORES.templates, STORES.settings, STORES.screenshots],
      "readwrite"
    );
    let addedTrades = 0;
    let updatedTrades = 0;
    let skippedTrades = 0;
    let addedTemplates = 0;
    let updatedTemplates = 0;
    let skippedTemplates = 0;

    const tradeStore = tx.objectStore(STORES.trades);
    const existingTradeIds = new Set((await requestPromise(tradeStore.getAllKeys())).map(String));
    for (const trade of payload.trades || []) {
      const exists = existingTradeIds.has(String(trade.id));
      if (exists && !opts.updateExisting) {
        skippedTrades += 1;
        continue;
      }
      tradeStore.put(trade);
      if (exists) updatedTrades += 1;
      else addedTrades += 1;
      existingTradeIds.add(String(trade.id));
    }

    const tplStore = tx.objectStore(STORES.templates);
    const existingTemplateIds = new Set((await requestPromise(tplStore.getAllKeys())).map(String));
    for (const template of payload.templates || []) {
      const exists = existingTemplateIds.has(String(template.id));
      if (exists && !opts.updateExisting) {
        skippedTemplates += 1;
        continue;
      }
      tplStore.put(template);
      if (exists) updatedTemplates += 1;
      else addedTemplates += 1;
      existingTemplateIds.add(String(template.id));
    }

    const shotStore = tx.objectStore(STORES.screenshots);
    const existingShotIds = new Set((await requestPromise(shotStore.getAllKeys())).map(String));
    (payload.screenshots || []).forEach((shot) => {
      if (!existingShotIds.has(String(shot.id))) shotStore.put(shot);
    });

    const settingsStore = tx.objectStore(STORES.settings);
    const existingSettingKeys = new Set((await requestPromise(settingsStore.getAllKeys())).map(String));
    Object.keys(payload.settings || {}).forEach((key) => {
      if (!existingSettingKeys.has(key) || opts.updateExisting) {
        settingsStore.put({ key, value: payload.settings[key] });
      }
    });

    await transactionDone(tx);
    return {
      addedTrades,
      updatedTrades,
      skippedTrades,
      addedTemplates,
      updatedTemplates,
      skippedTemplates,
      screenshots: (payload.screenshots || []).length,
    };
  }

  async function clearAllData() {
    const db = await open();
    const tx = db.transaction(
      [STORES.trades, STORES.templates, STORES.settings, STORES.screenshots],
      "readwrite"
    );
    Object.values(STORES).forEach((name) => tx.objectStore(name).clear());
    await transactionDone(tx);
  }

  async function clearTradesOnly() {
    const db = await open();
    const tx = db.transaction(STORES.trades, "readwrite");
    tx.objectStore(STORES.trades).clear();
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
    getStorageEstimate,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
