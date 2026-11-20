const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeMovements, costBeforeAds } = require("../services/revenueService");

const sale = (platform, amount = 2, date = "2026-11-03") => ({
  type: "export", approvalStatus: "approved", platform, source: "form", date: new Date(date),
  items: [{ amount, saleSnapshot: { unitRevenue: 100000, unitCost: 80000, unitProfit: 20000, unitAdsCost: 15000, unitCostBeforeAds: 65000, adsPercentApplied: 15 } }]
});

test("chỉ phiếu xuất đã duyệt tính doanh thu và lãi trước Ads theo tháng, sàn và ngày", () => {
  const report = summarizeMovements([
    sale("shopee"), sale("shopee", 1), sale("tiktok", 1),
    { ...sale("shopee"), approvalStatus: "pending" },
    { ...sale("shopee"), type: "return" },
    { ...sale("shopee"), source: "product_update" }
  ]);
  assert.equal(report.totals.orders, 3);
  assert.equal(report.totals.quantity, 4);
  assert.equal(report.totals.revenue, 400000);
  assert.equal(report.totals.costBeforeAds, 260000);
  assert.equal(report.totals.cost, 260000);
  assert.equal(report.totals.profit, 140000);
  assert.equal(report.byPlatform.shopee.profit, 105000);
  assert.equal(report.byPlatform.tiktok.profit, 35000);
  assert.equal(report.byDay[0].profit, 140000);
});

test("thay đổi tỷ lệ Ads tham khảo không thay đổi báo cáo nếu giá nhập và phí không đổi", () => {
  const movement = sale("shopee");
  const before = summarizeMovements([movement]);
  movement.items[0].saleSnapshot.adsPercentApplied = 99;
  movement.items[0].saleSnapshot.unitAdsCost = 99000;
  movement.items[0].saleSnapshot.unitProfit = -64000;
  assert.deepEqual(summarizeMovements([movement]), before);
});

test("dữ liệu chốt Ads cũ không còn được khấu trừ kể cả tháng không bán hàng", () => {
  const closings = [{ month: "2026-11", shopeeAds: 15000, tiktokAds: 20000 }];
  const report = summarizeMovements([], closings);
  assert.equal(report.totals.revenue, 0);
  assert.equal(report.totals.cost, 0);
  assert.equal(report.totals.profit, 0);
  assert.equal(report.byDay.length, 0);
  assert.deepEqual(summarizeMovements([sale("shopee")], closings), summarizeMovements([sale("shopee")]));
});

test("phiếu cũ thiếu dữ liệu giá hoặc không tách được Ads được báo riêng", () => {
  const movement = sale("shopee");
  movement.items[0].saleSnapshot = { unitRevenue: 100000, unitProfit: 20000 };
  const report = summarizeMovements([movement, { ...sale("shopee"), items: [{ amount: 3 }] }]);
  assert.equal(report.totals.unpricedItems, 5);
  assert.equal(report.totals.revenue, 0);
});

test("tách Ads tham khảo từ snapshot cũ để tính lãi trước Ads", () => {
  assert.equal(costBeforeAds({ unitRevenue: 100000, unitProfit: 20000, adsPercentApplied: 15 }), 65000);
  assert.equal(costBeforeAds({ unitRevenue: 100000, unitCost: 80000, unitAdsCost: 12000 }), 68000);
  assert.equal(costBeforeAds({ unitRevenue: 100000, unitCost: 80000, unitAdsCost: 0 }), 80000);
});

test("tổng lãi trước Ads theo sàn và ngày khớp tổng tháng", () => {
  const report = summarizeMovements([sale("shopee", 1, "2026-11-01"), sale("tiktok", 2, "2026-11-02")]);
  assert.equal(report.byDay[0].profit, 70000);
  assert.equal(report.byDay[1].profit, 35000);
  assert.equal(report.totals.profit, 105000);
  assert.equal(report.byPlatform.shopee.profit + report.byPlatform.tiktok.profit, report.totals.profit);
});
