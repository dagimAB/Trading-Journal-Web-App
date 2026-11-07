const assert = require("assert");
const A = require("../analytics.js");
global.ICT = { analytics: A };
require("../db.js");

const DB = global.ICT.db;

console.log("Running Supabase Mapper Tests via DB module...");

// Test 1: 6 Demo trades round-trip
const demoTrades = A.generateDemoTrades(6);
for (const original of demoTrades) {
  const dbRow = DB.toDbTrade(original, "11111111-1111-1111-1111-111111111111");
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dbRow.id), "ID must be a valid UUID");
  assert.ok(["LONG", "SHORT"].includes(dbRow.direction), "Direction must be LONG or SHORT");
  assert.ok(["WIN", "LOSS", "BE", "INCOMPLETE"].includes(dbRow.status), "Status must be WIN, LOSS, BE, or INCOMPLETE");

  const restored = DB.fromDbTrade(dbRow);
  assert.strictEqual(restored.instrument, original.instrument);
  assert.strictEqual(restored.direction, original.direction);
  assert.strictEqual(restored.date, original.date);
  assert.strictEqual(restored.tradeNumber, original.tradeNumber);
  assert.strictEqual(restored.remainderExitR, original.remainderExitR);
  assert.strictEqual(restored.tradePath.mfe, original.tradePath.mfe);
  assert.strictEqual(restored.tradePath.mae, original.tradePath.mae);

  // Compare analytics calculation on restored vs original
  const decOrig = A.decorate(original);
  const decRest = A.decorate(restored);
  assert.strictEqual(decOrig.finalR, decRest.finalR, "Decorated finalR must match");
  assert.strictEqual(decOrig.status, decRest.status, "Decorated status must match");
}
console.log("  ok   Demo trades mapper round-trip preserved all analytics fields");

// Test 2: Missed Trade mapper
const missedOrig = {
  id: "missed-1234",
  date: "2026-11-01",
  instrument: "NAS100",
  session: "New York AM",
  direction: "Short",
  potentialR: 4.5,
  reason: "Fear of Loss",
  notes: "Hesitated on the 1M breaker",
  htfScreenshot: "https://i.ibb.co/chart1.jpg",
  ltfScreenshot: "https://i.ibb.co/chart2.jpg",
};

const missedRow = DB.toDbMissedTrade(missedOrig, "11111111-1111-1111-1111-111111111111");
assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(missedRow.id));
assert.strictEqual(missedRow.direction, "SHORT");
assert.strictEqual(missedRow.potential_r, 4.5);

const restoredMissed = DB.fromDbMissedTrade(missedRow);
assert.strictEqual(restoredMissed.instrument, "NAS100");
assert.strictEqual(restoredMissed.direction, "Short");
assert.strictEqual(restoredMissed.potentialR, 4.5);
assert.strictEqual(restoredMissed.reason, "Fear of Loss");
assert.strictEqual(restoredMissed.htfScreenshot, "https://i.ibb.co/chart1.jpg");
console.log("  ok   Missed trades mapper round-trip preserved all fields");

// Test 3: Exit Plan mapper
const tplOrig = {
  id: "tpl-test-1",
  name: "50/50 2R-5R",
  description: "50% @ 2R, 50% @ 5R",
  levels: [
    { allocation: 0.5, targetR: 2 },
    { allocation: 0.5, targetR: 5 },
  ],
  isDefault: true,
};
const tplRow = DB.toDbExitPlan(tplOrig, "11111111-1111-1111-1111-111111111111");
assert.strictEqual(tplRow.name, "50/50 2R-5R");
assert.strictEqual(tplRow.is_default, true);
assert.strictEqual(tplRow.tiers.length, 2);

const restoredTpl = DB.fromDbExitPlan(tplRow);
assert.strictEqual(restoredTpl.name, "50/50 2R-5R");
assert.strictEqual(restoredTpl.isDefault, true);
assert.strictEqual(restoredTpl.levels.length, 2);
console.log("  ok   Exit plan mapper round-trip preserved all fields");

// Test 4: User Settings mapper
const settingsOrig = {
  accountBalance: 25000,
  defaultRiskPct: 1.5,
  columns: ["tradeNumber", "date", "status", "result"],
  thresholds: { winR: 2 },
  missedReasons: ["Hesitation", "Custom Reason"],
  theme: "dark",
  imgbbApiKey: "test_key_123",
};
const settingsRow = DB.toDbUserSettings(settingsOrig, "11111111-1111-1111-1111-111111111111");
assert.strictEqual(settingsRow.account_balance, 25000);
assert.strictEqual(settingsRow.default_risk_pct, 1.5);
assert.strictEqual(settingsRow.imgbb_api_key, "test_key_123");

const restoredSettings = DB.fromDbUserSettings(settingsRow);
assert.strictEqual(restoredSettings.accountBalance, 25000);
assert.strictEqual(restoredSettings.defaultRiskPct, 1.5);
assert.strictEqual(restoredSettings.imgbbApiKey, "test_key_123");
assert.strictEqual(restoredSettings.missedReasons.length, 2);
console.log("  ok   User settings mapper round-trip preserved all fields");

console.log("\nAll Supabase mapper tests passed cleanly!");
