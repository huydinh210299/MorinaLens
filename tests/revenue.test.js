const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeMovements } = require("../services/revenueService");

const sale = (type, approvalStatus, platform, amount, unitRevenue, unitProfit, source = "form", adsPercentApplied = 15) => ({
  type, approvalStatus, platform, source, date: new Date("2026-11-03"), items: [{ amount, saleSnapshot: { unitRevenue, unitProfit, adsPercentApplied } }]
});
test("doanh thu chỉ gồm phiếu xuất đã duyệt; phiếu hoàn và điều chỉnh kho không ảnh hưởng", () => {
  const report = summarizeMovements([
    sale("export", "approved", "shopee", 2, 100000, 20000),
    sale("export", "approved", "tiktok", 1, 80000, 10000),
    sale("export", "pending", "shopee", 1, 100000, 20000),
    sale("return", "approved", "shopee", 1, 100000, 20000),
    sale("export", "approved", "shopee", 5, 100000, 20000, "product_update")
  ]);
  assert.equal(report.totals.orders, 2);
  assert.equal(report.totals.quantity, 3);
  assert.equal(report.totals.revenue, 280000);
  assert.equal(report.totals.profit, 50000);
  assert.equal(report.totals.cost, 230000);
  assert.equal(report.totals.adsCost, 42000);
  assert.equal(report.byPlatform.tiktok.revenue, 80000);
  assert.equal(report.byPlatform.tiktok.adsCost, 12000);
});
test("phiếu cũ chưa có giá được báo riêng thay vì gán doanh thu bằng không", () => {
  const report = summarizeMovements([{ type: "export", approvalStatus: "approved", platform: "shopee", date: new Date("2026-11-04"), items: [{ amount: 3 }] }]);
  assert.equal(report.totals.unpricedItems, 3);
  assert.equal(report.totals.revenue, 0);
});
