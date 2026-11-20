const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ejs = require("ejs");
const MonthlyAdsClosing = require("../models/MonthlyAdsClosing");
const Movement = require("../models/ImportAndExport");
const { getMonthlyReport, summarizeMovements } = require("../services/revenueService");

test("mọi vai trò không thể xem hoặc ghi Ads tháng qua URL cũ", async (t) => {
  const router = require("../routes/inventoryRoutes");
  t.mock.method(MonthlyAdsClosing, "create", () => assert.fail("Không được ghi Ads"));
  t.mock.method(MonthlyAdsClosing, "find", () => assert.fail("Không được đọc Ads"));
  for (const role of ["admin", "staff"]) {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const status = await new Promise((resolve, reject) => router.handle({ url: "/ads", method, user: { role } },
        { sendStatus: resolve }, error => reject(error || new Error("Không xử lý URL cũ"))));
      assert.equal(status, 404);
    }
  }
});

test("báo cáo không đọc dữ liệu Ads tháng lịch sử và không sửa snapshot", async (t) => {
  const rows = [{ type: "export", approvalStatus: "approved", platform: "shopee", date: new Date("2020-01-01"),
    items: [{ amount: 2, saleSnapshot: { unitRevenue: 100000, unitCostBeforeAds: 65000 } }] }];
  const before = structuredClone(rows);
  t.mock.method(MonthlyAdsClosing, "find", () => assert.fail("Không được đọc Ads tháng"));
  t.mock.method(Movement, "find", () => ({ lean: async () => rows }));
  t.mock.method(Movement, "countDocuments", async () => 1);
  const report = await getMonthlyReport("2020-01");
  assert.equal(report.totals.profit, 70000);
  assert.equal(report.pendingCount, 1);
  assert.deepEqual(rows, before);
});

test("điều hướng và báo cáo không còn chức năng Ads tháng hoặc cảnh báo yêu cầu chốt", async () => {
  const helpers = { csrfToken: "test", money: String, dateTime: String, title: "Báo cáo", message: "", error: "", body: "" };
  for (const role of ["admin", "staff"]) {
    const currentUser = { role, username: role };
    for (const file of ["layouts/main.ejs", "pages/dashboard/index.ejs"]) {
      const html = await ejs.renderFile(path.join(__dirname, "../views", file), { ...helpers, currentUser,
        products: 1, outOfStock: 0, pending: 0, staff: 1, tiktokReady: false, tiktok: false });
      assert.doesNotMatch(html, /Chốt Ads|\/inventory\/ads/);
    }
  }
  const report = { ...summarizeMovements([]), pendingCount: 0 };
  const html = await ejs.renderFile(path.join(__dirname, "../views/pages/revenue/index.ejs"), { ...helpers, month: "2020-01", report,
    dailyPage: { items: [], total: 0, page: 1, limit: 20 } });
  assert.match(html, /Lãi trước Ads/);
  assert.match(html, /theo dõi trên Shopee/);
  assert.doesNotMatch(html, /Chốt Ads|\/inventory\/ads|chưa ghi nhận Ads|Báo cáo còn tạm tính|Lợi nhuận sau Ads/);
});
