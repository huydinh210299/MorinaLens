const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ejs = require("ejs");
const Product = require("../models/Product");
const User = require("../models/User");
const commission = require("../services/commissionService");
const revenue = require("../services/revenueService");
const { paginate, paginateRows } = require("../utils/pagination");

const render = (file, locals) => ejs.renderFile(path.join(__dirname, "../views", file), locals);
const links = html => [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll('&amp;', '&'), "http://localhost"));

test("phân trang thống nhất 20 dòng, tự về trang hợp lệ khi rỗng, sai hoặc quá giới hạn", () => {
  const rows = Array.from({ length: 45 }, (_, index) => index);
  assert.deepEqual(paginateRows(rows, 2).items, rows.slice(20, 40));
  const last = paginateRows(rows, 999);
  assert.equal(last.page, 3);
  assert.equal(last.total, 45);
  assert.equal(last.limit, 20);
  assert.deepEqual(last.items, [40, 41, 42, 43, 44]);
  assert.deepEqual(paginateRows([], 999).items, []);
  assert.equal(paginate(0, 999).page, 1);
  for (const value of [undefined, "bad", -1, 0]) assert.equal(paginate(45, value).page, 1);
});

test("thanh phân trang luôn hiện kể cả 0 hoặc 1 trang và khóa nút không dùng được", async () => {
  for (const total of [0, 1, 20]) {
    const html = await render("partials/pagination.ejs", { base: "/inventory", query: "", total, page: 1, limit: 20 });
    assert.match(html, /aria-label="Phân trang"/);
    assert.match(html, /Trang 1 \/ 1/);
    assert.equal(links(html).length, 0);
    assert.equal((html.match(/aria-disabled="true"/g) || []).length, 2);
  }
});

test("link phân trang giữ bộ lọc và ký tự đặc biệt, hỗ trợ lịch sử có trang riêng", async () => {
  const query = new URLSearchParams({ month: "2020-01", payrollPage: "2", q: 'lens & <script>"', commissionPage: "9" }).toString();
  const html = await render("partials/pagination.ejs", {
    base: "/users/example", query, total: 100, page: 2, limit: 20, pageParam: "commissionPage", anchor: "commission-history"
  });
  assert.match(html, /aria-current="page">2/);
  assert.doesNotMatch(html, /<script>/);
  for (const url of links(html)) {
    assert.equal(url.pathname, "/users/example");
    assert.equal(url.searchParams.get("month"), "2020-01");
    assert.equal(url.searchParams.get("payrollPage"), "2");
    assert.equal(url.searchParams.get("q"), 'lens & <script>"');
    assert.equal(url.searchParams.getAll("commissionPage").length, 1);
    assert.equal(url.hash, "#commission-history");
  }
});

test("danh sách sản phẩm lấy trang cuối hợp lệ sau khi đếm dữ liệu khớp tìm kiếm", async (t) => {
  const controller = require("../controllers/productController");
  const state = {};
  t.mock.method(Product, "countDocuments", async filter => { state.countFilter = filter; return 45; });
  t.mock.method(Product, "find", filter => {
    state.findFilter = filter;
    return { sort(value) { state.sort = value; return this; }, skip(value) { state.skip = value; return this; },
      limit(value) { state.limit = value; return this; }, select() { return this; }, lean: async () => [{ sku: "LAST" }] };
  });
  let data;
  await controller.index({ query: { page: "999", q: "LENS" }, user: { role: "staff" } }, { render: (_, value) => { data = value; } });
  assert.equal(data.page, 3);
  assert.equal(data.total, 45);
  assert.equal(state.skip, 40);
  assert.equal(state.limit, 20);
  assert.deepEqual(state.countFilter, state.findFilter);
  assert.equal(state.sort._id, -1);
});

test("danh sách nhân viên phân trang hợp lệ và tính hoa hồng theo tháng đã chọn", async (t) => {
  const controller = require("../controllers/userController");
  const state = {};
  t.mock.method(User, "countDocuments", async () => 41);
  t.mock.method(User, "find", () => ({ sort() { return this; }, skip(value) { state.skip = value; return this; },
    limit(value) { state.limit = value; return this; }, lean: async () => [{ _id: "user", username: "last" }] }));
  t.mock.method(commission, "monthly", async (items, month) => { state.month = month; return items; });
  let data;
  await controller.index({ query: { page: 999, month: "2020-01" } }, { render: (_, value) => { data = value; } });
  assert.equal(data.page, 3);
  assert.equal(state.skip, 40);
  assert.equal(state.limit, 20);
  assert.equal(state.month, "2020-01");
});

test("phân trang doanh thu theo ngày không làm thay đổi tổng doanh thu, phí hoặc lợi nhuận tháng", async (t) => {
  const controller = require("../controllers/revenueController");
  const movements = Array.from({ length: 31 }, (_, index) => ({ type: "export", approvalStatus: "approved", platform: "shopee",
    date: new Date(Date.UTC(2020, 0, index + 1)), items: [{ amount: 1, saleSnapshot: { unitRevenue: 100000, unitCostBeforeAds: 65000 } }] }));
  const report = { ...revenue.summarizeMovements(movements, [{ shopeeAds: 10000, tiktokAds: 0 }]), pendingCount: 0 };
  t.mock.method(revenue, "getMonthlyReport", async () => report);
  let data;
  await controller.index({ query: { month: "2020-01", page: 2 } }, { render: (_, value) => { data = value; } });
  assert.equal(data.dailyPage.items.length, 11);
  assert.equal(data.dailyPage.total, 31);
  assert.equal(data.report.byDay.length, 31);
  assert.equal(data.report.totals.revenue, 3100000);
  assert.equal(data.report.totals.profit, 1075000);
  const html = await render("pages/revenue/index.ejs", { ...data, money: String });
  assert.match(html, /3100000/);
  assert.match(html, /11\/01\/2020/);
  assert.doesNotMatch(html, /31\/01\/2020/);
  for (const url of links(html).filter(url => url.pathname === "/revenue")) assert.equal(url.searchParams.get("month"), "2020-01");
});

test("lịch sử hoa hồng và lương có trang độc lập, nhân viên vẫn chỉ xem lịch sử của mình", async (t) => {
  const controller = require("../controllers/userController");
  const months = Array.from({ length: 25 }, (_, index) => new Date(Date.UTC(2017, index, 1)).toISOString().slice(0, 7));
  const user = { _id: "user", username: "staff", role: "staff", active: true,
    commissions: months.map(month => ({ month, revenue: 100000, percent: 1, amount: 1000, closedAt: new Date() })),
    payroll: months.map(month => ({ month, amount: 50000, payments: [] })) };
  t.mock.method(User, "findById", () => ({ populate() { return this; }, lean: async () => structuredClone(user) }));
  const selectedCommission = { revenue: 100000, percent: 1, amount: 1000, closed: true };
  t.mock.method(commission, "monthly", async () => [{ commission: selectedCommission }]);
  const query = { month: "2020-01", commissionPage: 2, payrollPage: 2 };
  let data;
  await controller.detail({ params: { id: user._id }, query }, { render: (_, value) => { data = value; } });
  assert.equal(data.commissionHistory.items.length, 5);
  assert.equal(data.payrollHistory.items.length, 5);
  assert.equal(data.commissionHistory.total, 25);
  assert.equal(data.item.commissions.length, 25);
  const helpers = { money: String, dateTime: String, dateInput: () => "2020-01-31", csrfToken: "csrf" };
  const html = await render("pages/users/detail.ejs", { ...helpers, ...data });
  const historyLinks = links(html).filter(url => url.hash.includes("-history"));
  assert.ok(historyLinks.some(url => url.searchParams.get("commissionPage") === "1" && url.searchParams.get("payrollPage") === "2"));
  assert.ok(historyLinks.some(url => url.searchParams.get("payrollPage") === "1" && url.searchParams.get("commissionPage") === "2"));
  for (const url of historyLinks) assert.equal(url.searchParams.get("month"), "2020-01");
  await controller.ownCommission({ user: { _id: user._id }, query }, { render: (_, value) => { data = value; } });
  assert.equal(data.payrollHistory.total, 0);
  const own = await render("pages/users/detail.ejs", { ...helpers, ...data });
  for (const url of links(own).filter(url => url.hash === "#commission-history")) assert.equal(url.pathname, "/users/commission");
  assert.doesNotMatch(own, /Lịch sử lương/);
});
