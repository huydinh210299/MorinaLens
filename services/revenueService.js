const Movement = require("../models/ImportAndExport");
const DailyClosing = require("../models/DailyClosing");
const pricing = require("./pricingService");
const input = require("../utils/input");

function costBeforeAds(snapshot) {
  if (!snapshot || !Number.isFinite(snapshot.unitRevenue)) return null;
  if (Number.isFinite(snapshot.unitCostBeforeAds)) return snapshot.unitCostBeforeAds;
  const cost = Number.isFinite(snapshot.unitCost) ? snapshot.unitCost
    : Number.isFinite(snapshot.unitProfit) ? snapshot.unitRevenue - snapshot.unitProfit : null;
  if (cost === null) return null;
  let estimatedAds = snapshot.unitAdsCost;
  if (!Number.isFinite(estimatedAds) && Number.isFinite(snapshot.purchasePrice) && pricing.hasCompleteConfig(snapshot.config)) {
    estimatedAds = pricing.calculate(snapshot.listPrice, snapshot.purchasePrice, snapshot.config, snapshot.adsPercentApplied, snapshot.pricingVersion ?? 1)?.ads;
  }
  // Legacy snapshots without full inputs used Ads as a percentage of revenue.
  if (!Number.isFinite(estimatedAds) && Number.isFinite(snapshot.adsPercentApplied)) estimatedAds = snapshot.unitRevenue * snapshot.adsPercentApplied / 100;
  return Number.isFinite(estimatedAds) ? cost - estimatedAds : null;
}
function emptyTotals() {
  return { revenue: 0, costBeforeAds: 0, cost: 0, adsCost: 0, profit: 0, quantity: 0, orders: 0, unpricedItems: 0 };
}
function summarizeMovements(movements, closings = []) {
  const totals = emptyTotals();
  const byPlatform = { shopee: emptyTotals(), tiktok: emptyTotals() };
  const byDay = new Map();
  const dayRow = (day) => {
    if (!byDay.has(day)) byDay.set(day, { ...emptyTotals(), day, adsRecorded: false });
    return byDay.get(day);
  };
  for (const movement of movements) {
    if (movement.type !== "export" || movement.approvalStatus !== "approved" || movement.source === "product_update") continue;
    const platform = movement.platform === "tiktok" ? "tiktok" : "shopee";
    const daily = dayRow(new Date(movement.date).toISOString().slice(0, 10));
    const targets = [totals, byPlatform[platform], daily];
    for (const target of targets) target.orders++;
    for (const item of movement.items) {
      const unitCost = costBeforeAds(item.saleSnapshot);
      if (unitCost === null) {
        for (const target of targets) target.unpricedItems += item.amount;
        continue;
      }
      for (const target of targets) {
        target.revenue += item.saleSnapshot.unitRevenue * item.amount;
        target.costBeforeAds += unitCost * item.amount;
        target.quantity += item.amount;
      }
    }
  }
  // A daily expense is deducted once, even on a day without sales.
  for (const closing of closings) {
    const daily = dayRow(new Date(closing.date).toISOString().slice(0, 10));
    daily.adsRecorded = true;
    for (const platform of ["shopee", "tiktok"]) {
      const amount = closing[platform + "Ads"];
      totals.adsCost += amount;
      byPlatform[platform].adsCost += amount;
      daily.adsCost += amount;
    }
  }
  for (const target of [totals, ...Object.values(byPlatform), ...byDay.values()]) {
    target.cost = target.costBeforeAds + target.adsCost;
    target.profit = target.revenue - target.cost;
  }
  const days = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  totals.unclosedDays = days.filter((row) => row.orders > 0 && !row.adsRecorded).length;
  return { totals, byPlatform, byDay: days };
}
async function getMonthlyReport(month) {
  input.month(month);
  const [year, number] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, number - 1, 1));
  const end = new Date(Date.UTC(year, number, 1));
  const range = { $gte: start, $lt: end };
  const [movements, closings, pendingCount] = await Promise.all([
    Movement.find({ type: "export", approvalStatus: "approved", source: { $ne: "product_update" }, date: range }).lean(),
    DailyClosing.find({ date: range }).lean(),
    Movement.countDocuments({ approvalStatus: "pending", date: range })
  ]);
  const report = summarizeMovements(movements, closings);
  report.pendingCount = pendingCount;
  return report;
}
module.exports = { summarizeMovements, getMonthlyReport, costBeforeAds };
