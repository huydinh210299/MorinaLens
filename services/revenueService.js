const Movement = require("../models/ImportAndExport");

function summarizeMovements(movements) {
  const totals = { revenue: 0, cost: 0, adsCost: 0, profit: 0, quantity: 0, orders: 0, unpricedItems: 0 };
  const byPlatform = { shopee: { revenue: 0, cost: 0, adsCost: 0, profit: 0, quantity: 0, orders: 0 }, tiktok: { revenue: 0, cost: 0, adsCost: 0, profit: 0, quantity: 0, orders: 0 } };
  const byDay = new Map();
  for (const movement of movements) {
    if (movement.type !== "export" || movement.approvalStatus !== "approved" || movement.source === "product_update") continue;
    totals.orders += 1;
    const platform = movement.platform === "tiktok" ? "tiktok" : "shopee";
    const day = new Date(movement.date).toISOString().slice(0, 10);
    const daily = byDay.get(day) || { day, revenue: 0, adsCost: 0, profit: 0, quantity: 0, orders: 0 };
    byPlatform[platform].orders += 1;
    daily.orders += 1;
    for (const item of movement.items) {
      const snapshot = item.saleSnapshot;
      if (!snapshot || !Number.isFinite(snapshot.unitRevenue) || !Number.isFinite(snapshot.unitProfit)) {
        totals.unpricedItems += item.amount;
        continue;
      }
      const revenue = snapshot.unitRevenue * item.amount;
      const profit = snapshot.unitProfit * item.amount;
      const cost = revenue - profit;
      const adsCost = Number.isFinite(snapshot.adsPercentApplied) ? revenue * snapshot.adsPercentApplied / 100 : 0;
      totals.revenue += revenue; totals.profit += profit; totals.cost += cost; totals.adsCost += adsCost; totals.quantity += item.amount;
      byPlatform[platform].revenue += revenue; byPlatform[platform].profit += profit; byPlatform[platform].cost += cost; byPlatform[platform].adsCost += adsCost; byPlatform[platform].quantity += item.amount;
      daily.revenue += revenue; daily.adsCost += adsCost; daily.profit += profit; daily.quantity += item.amount;
    }
    byDay.set(day, daily);
  }
  return { totals, byPlatform, byDay: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)) };
}

async function getMonthlyReport(month) {
  const [year, number] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, number - 1, 1));
  const end = new Date(Date.UTC(year, number, 1));
  const movements = await Movement.find({ type: "export", approvalStatus: "approved", source: { $ne: "product_update" }, date: { $gte: start, $lt: end } }).lean();
  return summarizeMovements(movements);
}
module.exports = { summarizeMovements, getMonthlyReport };
