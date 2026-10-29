const assert = require("assert");
const A = require("../analytics.js");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok   " + name);
  } catch (err) {
    failures.push({ name, err });
    console.log("  FAIL " + name);
    console.log("       " + err.message);
  }
}

function baseTrade(overrides) {
  return Object.assign(
    {
      id: "t1",
      tradeNumber: 1,
      date: "2026-10-29",
      instrument: "NAS100",
      direction: "Long",
      entry: 100,
      stopLoss: 98,
      riskR: 1,
      exitPlan: [
        { allocation: 0.3, targetR: 2 },
        { allocation: 0.7, targetR: 6 },
      ],
      tradePath: { mfe: 7.2, mae: 0.4, pathComplete: true, waypoints: null },
      remainderExitR: null,
      levelsHitOverride: null,
      finalROverride: null,
      exitReason: "SL",
    },
    overrides || {}
  );
}

function tradeWithR(n, r, extra) {
  return Object.assign(
    {
      id: "r" + n,
      tradeNumber: n,
      date: "2026-01-0" + ((n % 9) + 1),
      instrument: "NAS100",
      direction: "Long",
      entry: 100,
      stopLoss: 98,
      riskR: 1,
      exitPlan: [{ allocation: 1, targetR: 4 }],
      tradePath: { mfe: 0, mae: 0, pathComplete: true, waypoints: null },
      remainderExitR: 0,
      levelsHitOverride: null,
      finalROverride: r,
      exitReason: "Manual Exit",
    },
    extra || {}
  );
}

console.log("\nAppendix F worked examples\n");

test("F1 long, both levels reached -> +4.8R", () => {
  const t = baseTrade();
  assert.strictEqual(A.targetPriceForTrade(t, 2), 104);
  assert.strictEqual(A.targetPriceForTrade(t, 6), 112);
  assert.deepStrictEqual(A.levelHitState(t).hit, [true, true]);
  assert.strictEqual(A.finalR(t), 4.8);
});

test("F2 short partial plan stopped -> +0.5R", () => {
  const t = baseTrade({
    instrument: "EURUSD",
    direction: "Short",
    entry: 1.1,
    stopLoss: 1.102,
    exitPlan: [
      { allocation: 0.5, targetR: 2 },
      { allocation: 0.5, targetR: 4 },
    ],
    tradePath: { mfe: 3.1, mae: 0.2, pathComplete: true },
    exitReason: "SL",
  });
  assert.strictEqual(A.clampNumber(A.targetPriceForTrade(t, 2), 6), 1.096);
  assert.strictEqual(A.clampNumber(A.targetPriceForTrade(t, 4), 6), 1.092);
  assert.deepStrictEqual(A.levelHitState(t).hit, [true, false]);
  assert.strictEqual(A.finalR(t), 0.5);
});

test("F3 same path, different plans (simulated)", () => {
  const t = baseTrade({
    direction: "Short",
    entry: 1.1,
    stopLoss: 1.102,
    exitPlan: [
      { allocation: 0.5, targetR: 2 },
      { allocation: 0.5, targetR: 4 },
    ],
    tradePath: { mfe: 3.1, mae: 0.2, pathComplete: true },
  });
  assert.strictEqual(A.evaluatePlanForTrade(t, [{ allocation: 1, targetR: 4 }]).simulatedR, -1);
  assert.strictEqual(
    A.evaluatePlanForTrade(t, [
      { allocation: 0.5, targetR: 2 },
      { allocation: 0.5, targetR: 4 },
    ]).simulatedR,
    0.5
  );
  assert.strictEqual(
    A.evaluatePlanForTrade(t, [
      { allocation: 0.25, targetR: 2 },
      { allocation: 0.25, targetR: 4 },
      { allocation: 0.5, targetR: 7 },
    ]).simulatedR,
    -0.25
  );
});

test("F4 incomplete path -> Insufficient / Exact", () => {
  const t = baseTrade({ tradePath: { mfe: 3.1, mae: 0.2, pathComplete: false } });
  const mid = A.evaluatePlanForTrade(t, [
    { allocation: 0.5, targetR: 2 },
    { allocation: 0.5, targetR: 4 },
  ]);
  assert.strictEqual(mid.quality, "Insufficient");
  assert.strictEqual(mid.simulatedR, null);
  const exact = A.evaluatePlanForTrade(t, [{ allocation: 1, targetR: 3 }]);
  assert.strictEqual(exact.quality, "Exact");
  assert.strictEqual(exact.simulatedR, 3);
});

test("F5 levels-hit override -> +0.6R, simulated +4.8R", () => {
  const t = baseTrade({
    tradePath: { mfe: 8, mae: 0.4, pathComplete: true },
    levelsHitOverride: [true, false],
    remainderExitR: 0,
    exitReason: "BE",
  });
  assert.strictEqual(A.finalR(t), 0.6);
  assert.strictEqual(
    A.evaluatePlanForTrade(t, [
      { allocation: 0.3, targetR: 2 },
      { allocation: 0.7, targetR: 6 },
    ]).simulatedR,
    4.8
  );
});

test("F6 statistics and drawdown", () => {
  const values = [3, -1, -1, 2, -1, -1, -1, 4];
  const trades = values.map((r, i) => tradeWithR(i + 1, r));
  const stats = A.computeStats(trades, { orderBy: "tradeNumber" });
  assert.strictEqual(stats.total, 8);
  assert.strictEqual(stats.totalR, 4);
  assert.strictEqual(stats.avgR, 0.5);
  assert.strictEqual(stats.wins, 3);
  assert.strictEqual(stats.losses, 5);
  assert.strictEqual(stats.winRate, 37.5);
  assert.strictEqual(stats.profitFactor, 1.8);
  assert.strictEqual(stats.maxDrawdown, 3);
  assert.deepStrictEqual(stats.equity, [3, 2, 1, 3, 2, 1, 0, 4]);
  assert.strictEqual(stats.currentEquity, 4);
  assert.strictEqual(stats.longestWinStreak, 1);
  assert.strictEqual(stats.longestLoseStreak, 3);
});

test("F7 day of week is timezone independent", () => {
  assert.strictEqual(A.dayOfWeek("2026-10-29"), "Thursday");
  assert.strictEqual(A.dayOfWeek("2024-02-29"), "Thursday");
  assert.strictEqual(A.dayOfWeek("2025-12-31"), "Wednesday");
  assert.strictEqual(A.dayOfWeek("2026-01-01"), "Thursday");
  assert.strictEqual(A.dayOfWeek("2026-02-30"), null);
});

console.log("\nAppendix B / E edge cases\n");

test("allocation tolerance accepts 33.3/33.3/33.4 and rejects 33.3 x3", () => {
  const good = A.validateExitPlan([
    { allocation: 0.333, targetR: 3 },
    { allocation: 0.333, targetR: 6 },
    { allocation: 0.334, targetR: 9 },
  ]);
  assert.strictEqual(good.valid, true);
  const bad = A.validateExitPlan([
    { allocation: 0.333, targetR: 3 },
    { allocation: 0.333, targetR: 6 },
    { allocation: 0.333, targetR: 9 },
  ]);
  assert.strictEqual(bad.valid, false);
  assert.ok(bad.errors.some((e) => /100%/.test(e.message)));
});

test("1, 2, 3 and 4+ level plans compute targets and Final R", () => {
  const four = baseTrade({
    exitPlan: [
      { allocation: 0.25, targetR: 2 },
      { allocation: 0.25, targetR: 4 },
      { allocation: 0.25, targetR: 6 },
      { allocation: 0.25, targetR: 8 },
    ],
    tradePath: { mfe: 6.5, mae: 0.3, pathComplete: true },
    exitReason: "SL",
  });
  assert.deepStrictEqual(
    four.exitPlan.map((l) => A.targetPriceForTrade(four, l.targetR)),
    [104, 108, 112, 116]
  );
  assert.strictEqual(A.finalR(four), 0.25 * 2 + 0.25 * 4 + 0.25 * 6 + 0.25 * -1);
});

test("decimal R values are preserved and totalled", () => {
  const trades = [tradeWithR(1, 4.7), tradeWithR(2, -0.3), tradeWithR(3, 5.25)];
  const stats = A.computeStats(trades, {});
  assert.strictEqual(A.clampNumber(stats.totalR, 6), 9.65);
  assert.strictEqual(A.clampNumber(stats.avgR, 6), A.clampNumber(9.65 / 3, 6));
});

test("manual Final R override wins over calculation", () => {
  const t = baseTrade({ finalROverride: -0.3 });
  assert.strictEqual(A.finalR(t), -0.3);
  assert.strictEqual(A.tradeStatus(t), "completed");
});

test("reduced risk scales Final R but not MFE/MAE", () => {
  const t = baseTrade({ riskR: 0.5 });
  assert.strictEqual(A.finalR(t), 2.4);
  const d = A.decorate(t);
  assert.strictEqual(d.finalR, 2.4);
  assert.strictEqual(d.mfe, 7.2);
  assert.strictEqual(d.mae, 0.4);
});

test("profit factor shows infinity without losses and null with no trades", () => {
  const onlyWins = A.computeStats([tradeWithR(1, 3), tradeWithR(2, 2)], {});
  assert.strictEqual(onlyWins.profitFactor, Infinity);
  const empty = A.computeStats([], {});
  assert.strictEqual(empty.total, 0);
  assert.strictEqual(empty.profitFactor, null);
  assert.strictEqual(empty.winRate, null);
});

test("trade with no MFE is incomplete; no MAE still counts in R stats", () => {
  const t = baseTrade({ tradePath: { mfe: null, mae: null, pathComplete: false }, remainderExitR: null });
  assert.strictEqual(A.finalR(t), null);
  assert.strictEqual(A.tradeStatus(t), "incomplete");
  const withR = tradeWithR(1, 2, { tradePath: { mfe: 4, mae: null, pathComplete: true } });
  const stats = A.computeStats([withR], {});
  assert.strictEqual(stats.total, 1);
  assert.strictEqual(stats.totalR, 2);
  assert.strictEqual(stats.avgMAE, null);
  assert.strictEqual(stats.maeCount, 0);
  assert.strictEqual(stats.avgMFE, 4);
});

test("MFE below a hit level is a warning, not an error", () => {
  const t = baseTrade({ tradePath: { mfe: 1, mae: 0.2, pathComplete: true }, levelsHitOverride: [true, true] });
  const result = A.validateTrade(t);
  assert.strictEqual(result.valid, true);
  assert.ok(result.warnings.some((w) => w.field === "levelsHit"));
});

test("validation blocks wrong-side stop and bad risk", () => {
  const long = baseTrade({ stopLoss: 101 });
  const r1 = A.validateTrade(long);
  assert.strictEqual(r1.valid, false);
  assert.ok(r1.errors.some((e) => e.field === "stopLoss"));
  const zeroRisk = baseTrade({ riskR: 0 });
  assert.strictEqual(A.validateTrade(zeroRisk).valid, false);
  const negMFE = baseTrade({ tradePath: { mfe: -1, mae: 0, pathComplete: true } });
  assert.ok(A.validateTrade(negMFE).errors.some((e) => e.field === "mfe"));
});

test("target-hit rates use MFE >= threshold", () => {
  const trades = [
    baseTrade({ id: "a", tradeNumber: 1, tradePath: { mfe: 0.9, mae: 0.2, pathComplete: true } }),
    baseTrade({ id: "b", tradeNumber: 2, tradePath: { mfe: 2, mae: 0.2, pathComplete: true } }),
    baseTrade({ id: "c", tradeNumber: 3, tradePath: { mfe: 4.1, mae: 0.2, pathComplete: false } }),
    baseTrade({ id: "d", tradeNumber: 4, tradePath: { mfe: null, mae: 0.2, pathComplete: false }, remainderExitR: -1 }),
  ];
  const rates = A.targetHitRates(trades, [1, 2, 4, 9]);
  assert.deepStrictEqual(
    rates.map((r) => [r.threshold, r.hits, r.total]),
    [
      [1, 2, 3],
      [2, 2, 3],
      [4, 1, 3],
      [9, 0, 3],
    ]
  );
  const pathOnly = A.targetHitRates(trades, [2], { onlyCompletePath: true });
  assert.strictEqual(pathOnly[0].total, 2);
  assert.strictEqual(pathOnly[0].hits, 1);
});

test("distributions place boundary values in the higher range", () => {
  const trades = [
    baseTrade({ id: "a", tradeNumber: 1, tradePath: { mfe: 0.99, mae: 0.25, pathComplete: true }, finalROverride: 1 }),
    baseTrade({ id: "b", tradeNumber: 2, tradePath: { mfe: 1, mae: 0.5, pathComplete: true }, finalROverride: 2 }),
    baseTrade({ id: "c", tradeNumber: 3, tradePath: { mfe: 3, mae: 1, pathComplete: true }, finalROverride: 3 }),
  ];
  const mfe = A.mfeDistribution(trades, [1, 3, 6, 9]);
  assert.deepStrictEqual(mfe.map((b) => b.count), [1, 1, 1, 0, 0]);
  assert.deepStrictEqual(mfe.map((b) => b.label), ["<1R", "1R–3R", "3R–6R", "6R–9R", "9R+"]);
  const mae = A.maeDistribution(trades, [0.25, 0.5, 0.75, 1]);
  assert.deepStrictEqual(mae.map((b) => b.count), [0, 1, 1, 0, 1]);
  assert.strictEqual(mae[4].label, ">1R");
});

test("streaks: breakeven breaks both streaks", () => {
  const values = [1, 1, 0, -1, -1, 1, 0, -1];
  const trades = values.map((r, i) => tradeWithR(i + 1, r));
  const stats = A.computeStats(trades, {});
  assert.strictEqual(stats.longestWinStreak, 2);
  assert.strictEqual(stats.longestLoseStreak, 2);
});

test("recorded comparison groups identical plans and keeps template name", () => {
  const a = baseTrade({ id: "a", tradeNumber: 1, exitPlanTemplateId: "tpl-30-70-3-6", exitPlanTemplateName: "30/70 3R-6R" });
  const b = baseTrade({ id: "b", tradeNumber: 2, exitPlanTemplateId: "tpl-30-70-3-6", exitPlanTemplateName: "30/70 3R-6R" });
  const c = baseTrade({
    id: "c",
    tradeNumber: 3,
    exitPlan: [{ allocation: 1, targetR: 4 }],
    exitPlanTemplateId: "tpl-100-4r",
    exitPlanTemplateName: "Full 4R",
  });
  const groups = A.recordedPlanComparison([a, b, c], {});
  assert.strictEqual(groups.length, 2);
  const group = groups.find((g) => g.tradeIds.length === 2);
  assert.strictEqual(group.name, "30/70 3R-6R");
  assert.strictEqual(group.label, "Recorded");
});

test("simulated comparison excludes insufficients and honours onlyCommon", () => {
  const complete = baseTrade({ id: "a", tradeNumber: 1 });
  const incomplete = baseTrade({
    id: "b",
    tradeNumber: 2,
    tradePath: { mfe: 3.1, mae: 0.2, pathComplete: false },
  });
  const plans = [
    { id: "p1", name: "Full 4R", levels: [{ allocation: 1, targetR: 4 }] },
    { id: "p2", name: "50/50 2R-4R", levels: [{ allocation: 0.5, targetR: 2 }, { allocation: 0.5, targetR: 4 }] },
  ];
  const all = A.simulatedPlanComparison([complete, incomplete], plans, { onlyCommon: false });
  assert.strictEqual(all[0].evaluated, 1);
  assert.strictEqual(all[0].excluded, 1);
  assert.strictEqual(all[1].evaluated, 1);
  assert.strictEqual(all[1].excluded, 1);
  const common = A.simulatedPlanComparison([complete, incomplete], plans, { onlyCommon: true });
  assert.strictEqual(common[0].evaluated, 1);
  assert.strictEqual(common[0].excluded, 1);
  assert.strictEqual(common[1].evaluated, 1);
  assert.strictEqual(common[1].excluded, 1);
});

test("live Exit Plan preview matches Final R", () => {
  const preview = A.planPreview(
    [
      { allocation: 0.3, targetR: 2 },
      { allocation: 0.7, targetR: 6 },
    ],
    baseTrade()
  );
  assert.strictEqual(preview.valid, true);
  assert.strictEqual(preview.finalR, 4.8);
  const bad = A.planPreview([{ allocation: 0.5, targetR: 2 }], baseTrade());
  assert.strictEqual(bad.valid, false);
});

test("filters apply to derived result, ranges and search", () => {
  const trades = [
    baseTrade({ id: "a", tradeNumber: 1, notes: "London sweep", finalROverride: 4 }),
    baseTrade({ id: "b", tradeNumber: 2, notes: "NY reversal", finalROverride: -1 }),
    baseTrade({ id: "c", tradeNumber: 3, notes: "London FVG", finalROverride: 0 }),
  ];
  assert.strictEqual(A.applyFilters(trades, { result: "win" }, A.defaultSettings()).length, 1);
  assert.strictEqual(A.applyFilters(trades, { search: "london" }, A.defaultSettings()).length, 2);
  assert.strictEqual(A.applyFilters(trades, { mfeMin: 5, mfeMax: 8 }, A.defaultSettings()).length, 3);
  assert.strictEqual(A.applyFilters(trades, { mfeAtLeast: 7 }, A.defaultSettings()).length, 3);
  const low = baseTrade({ id: "d", tradeNumber: 4, tradePath: { mfe: 5, mae: 0.2, pathComplete: true } });
  assert.strictEqual(A.applyFilters(trades.concat([low]), { mfeAtLeast: 7 }, A.defaultSettings()).length, 3);
});

test("demo generator respects count, numbering and isDemo flag", () => {
  const trades = A.generateDemoTrades(120, { seed: 7 });
  assert.strictEqual(trades.length, 120);
  assert.ok(trades.every((t) => t.isDemo === true));
  assert.deepStrictEqual(
    trades.map((t) => t.tradeNumber),
    Array.from({ length: 120 }, (_, i) => i + 1)
  );
  const completed = trades.filter((t) => A.finalR(t) !== null);
  assert.ok(completed.length > 100);
});

test("session suggestion uses historical clock time", () => {
  assert.strictEqual(A.sessionFromTime("19:15"), "Asia");
  assert.strictEqual(A.sessionFromTime("03:00"), "London");
  assert.strictEqual(A.sessionFromTime("08:30"), "London/NY Overlap");
  assert.strictEqual(A.sessionFromTime("11:00"), "New York AM");
  assert.strictEqual(A.sessionFromTime("14:00"), "New York PM");
  assert.strictEqual(A.sessionFromTime("17:30"), "Other");
  assert.strictEqual(A.sessionFromTime(""), null);
});

test("performance: 5,000 trades compute under 2000ms", () => {
  const trades = A.generateDemoTrades(5000, { seed: 99 });
  const started = Date.now();
  const stats = A.computeStats(trades, {});
  const rates = A.targetHitRates(trades, [1, 2, 3, 4, 6, 9]);
  const groups = A.groupStats(trades, "session", {});
  const elapsed = Date.now() - started;
  assert.ok(stats.total > 4000);
  assert.strictEqual(rates.length, 6);
  assert.ok(groups.length > 0);
  assert.ok(elapsed < 2000, "took " + elapsed + "ms");
  console.log("       5000-trade analytics: " + elapsed + "ms");
});

console.log("\n" + passed + " passed, " + failures.length + " failed\n");
if (failures.length) {
  failures.forEach((f) => console.error(f.name + ": " + f.err.stack));
  process.exit(1);
}
