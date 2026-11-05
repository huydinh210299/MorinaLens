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

test("báo cáo dùng tiền Ads đã lưu theo thực nhận; phiếu cũ giữ cách tính lịch sử", () => {
  const current = sale("export", "approved", "shopee", 2, 70966, 10000);
  current.items[0].saleSnapshot.unitAdsCost = 7054.65;
  current.items[0].saleSnapshot.pricingVersion = 2;
  const legacy = sale("export", "approved", "shopee", 1, 100000, 20000);
  const report = summarizeMovements([current, legacy]);
  assert.equal(report.totals.adsCost, 7054.65 * 2 + 15000);
  assert.equal(report.byPlatform.shopee.adsCost, report.totals.adsCost);
  assert.equal(report.byDay[0].adsCost, report.totals.adsCost);
  current.items[0].saleSnapshot.unitAdsCost = 0;
  assert.equal(summarizeMovements([current]).totals.adsCost, 0);
});
