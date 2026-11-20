const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeMovements, costBeforeAds } = require("../services/revenueService");

const sale = (platform, amount = 2, date = "2026-11-03") => ({
  type: "export", approvalStatus: "approved", platform, source: "form", date: new Date(date),
  items: [{ amount, saleSnapshot: { unitRevenue: 100000, unitCost: 80000, unitProfit: 20000, unitAdsCost: 15000, unitCostBeforeAds: 65000, adsPercentApplied: 15 } }]
});
const closing = (shopeeAds, tiktokAds) => ({ month: "2026-11", shopeeAds, tiktokAds });

test("chỉ phiếu xuất đã duyệt tính doanh thu, trừ Ads đúng một lần theo tháng và sàn", () => {
  const report = summarizeMovements([
    sale("shopee"), sale("shopee", 1), sale("tiktok", 1),
    { ...sale("shopee"), approvalStatus: "pending" },
    { ...sale("shopee"), type: "return" },
    { ...sale("shopee"), source: "product_update" }
  ], [closing(10000, 5000)]);
  assert.equal(report.totals.orders, 3);
  assert.equal(report.totals.quantity, 4);
  assert.equal(report.totals.revenue, 400000);
  assert.equal(report.totals.costBeforeAds, 260000);
  assert.equal(report.totals.adsCost, 15000);
  assert.equal(report.totals.cost, 275000);
  assert.equal(report.totals.profit, 125000);
  assert.equal(report.byPlatform.shopee.profit, 95000);
  assert.equal(report.byPlatform.tiktok.profit, 30000);
  assert.equal(report.byDay[0].profit, 140000);
  assert.equal(report.adsRecorded, true);
});

test("thay đổi tỷ lệ Ads tham khảo không thay đổi báo cáo nếu giá nhập và phí không đổi", () => {
  const movement = sale("shopee");
  const actual = [closing(20000, 0)];
  const before = summarizeMovements([movement], actual);
  movement.items[0].saleSnapshot.adsPercentApplied = 99;
  movement.items[0].saleSnapshot.unitAdsCost = 99000;
  movement.items[0].saleSnapshot.unitProfit = -64000;
  assert.deepEqual(summarizeMovements([movement], actual), before);
});

test("tháng không bán hàng vẫn trừ chi phí quảng cáo và có thể phát sinh lỗ", () => {
  const report = summarizeMovements([], [closing(15000, 20000)]);
  assert.equal(report.totals.revenue, 0);
  assert.equal(report.totals.profit, -35000);
  assert.equal(report.byPlatform.tiktok.profit, -20000);
  assert.equal(report.byDay.length, 0);
  assert.equal(report.adsRecorded, true);
});

test("phân biệt tháng chưa nhập Ads với đã nhập 0, không thay bằng Ads ước tính", () => {
  const unclosed = summarizeMovements([sale("shopee")]);
  assert.equal(unclosed.totals.adsCost, 0);
  assert.equal(unclosed.adsRecorded, false);
  const zero = summarizeMovements([sale("shopee")], [closing(0, 0)]);
  assert.equal(zero.adsRecorded, true);
  assert.equal(zero.totals.adsCost, 0);
});

test("phiếu cũ thiếu dữ liệu giá hoặc không tách được Ads được báo riêng", () => {
  const movement = sale("shopee");
  movement.items[0].saleSnapshot = { unitRevenue: 100000, unitProfit: 20000 };
  const report = summarizeMovements([movement, { ...sale("shopee"), items: [{ amount: 3 }] }]);
  assert.equal(report.totals.unpricedItems, 5);
  assert.equal(report.totals.revenue, 0);
});

test("tách Ads tham khảo từ snapshot cũ trước khi trừ chi phí thực tế", () => {
  assert.equal(costBeforeAds({ unitRevenue: 100000, unitProfit: 20000, adsPercentApplied: 15 }), 65000);
  assert.equal(costBeforeAds({ unitRevenue: 100000, unitCost: 80000, unitAdsCost: 12000 }), 68000);
  assert.equal(costBeforeAds({ unitRevenue: 100000, unitCost: 80000, unitAdsCost: 0 }), 80000);
});

test("Ads chỉ tính vào tháng, không phân bổ vào ngày và tổng sàn khớp tổng tháng", () => {
  const report = summarizeMovements([sale("shopee", 1, "2026-11-01"), sale("tiktok", 2, "2026-11-02")], [
    closing(1000, 0), closing(0, 4000)
  ]);
  assert.equal(report.byDay[0].profit, 70000);
  assert.equal(report.byDay[1].profit, 35000);
  assert.equal(report.totals.profit, 100000);
  assert.equal(report.byPlatform.shopee.profit + report.byPlatform.tiktok.profit, report.totals.profit);
});

test("cộng nhiều lần Ads tháng, mỗi khoản trừ đúng một lần", () => {
  const report = summarizeMovements([sale("shopee"), sale("tiktok")], [closing(10000, 5000), closing(7000, 3000)]);
  assert.equal(report.totals.adsCost, 25000);
  assert.equal(report.totals.profit, 115000);
  assert.equal(report.byPlatform.shopee.adsCost, 17000);
  assert.equal(report.byPlatform.tiktok.adsCost, 8000);
  assert.equal(report.byPlatform.shopee.profit + report.byPlatform.tiktok.profit, report.totals.profit);
  assert.equal(report.byDay[0].adsCost, 0);
  assert.equal(report.byDay[0].profit, 140000);
});
