const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const ejs = require("ejs");
const mongoose = require("mongoose");
const MonthlyAdsClosing = require("../models/MonthlyAdsClosing");
const Movement = require("../models/ImportAndExport");
const service = require("../services/monthlyAdsService");
const { monthRange } = require("../utils/businessDate");
const { getMonthlyReport } = require("../services/revenueService");

const admin = { _id: new mongoose.Types.ObjectId().toString(), role: "admin" };
const body = (overrides = {}) => ({ month: "2020-01", shopeeAds: "10000", tiktokAds: "5000", note: "Đợt 1", requestId: randomUUID(), ...overrides });
function fixture(t) {
  const state = { entries: [], movements: [], fail: false };
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "date") return row.date >= value.$gte && row.date < value.$lt;
    if (value && typeof value === "object" && "$ne" in value) return row[key] !== value.$ne;
    return row[key] === value;
  });
  const query = (data) => ({
    populate() { return this; }, sort() { return this; }, lean: async () => structuredClone(data)
  });
  t.mock.method(MonthlyAdsClosing, "find", (filter) => query(state.entries.filter((row) => matches(row, filter))));
  t.mock.method(MonthlyAdsClosing, "findOne", (filter) => query(state.entries.find((row) => matches(row, filter))));
  t.mock.method(MonthlyAdsClosing, "create", async (data) => {
    if (state.fail) throw new Error("Lỗi lưu Ads giả lập");
    if (state.entries.some((row) => row.requestId === data.requestId)) throw Object.assign(new Error("Duplicate request"), { code: 11000 });
    assert.ifError(new MonthlyAdsClosing(data).validateSync());
    const entry = { _id: new mongoose.Types.ObjectId().toString(), ...structuredClone(data) };
    state.entries.push(entry);
    return entry;
  });
  t.mock.method(Movement, "find", (filter) => query(state.movements.filter((row) => matches(row, filter))));
  t.mock.method(Movement, "countDocuments", async (filter) => state.movements.filter((row) => matches(row, filter)).length);
  t.mock.method(Movement, "updateMany", () => { throw new Error("Chốt Ads không được duyệt phiếu kho"); });
  return state;
}

test("chọn tháng cũ và chốt nhiều lần cộng dồn, lưu người, ghi chú, thời điểm", async (t) => {
  const state = fixture(t);
  await service.close(body(), admin);
  await service.close(body({ shopeeAds: "20000", tiktokAds: "0", note: "Đợt 2" }), admin);
  await service.close(body({ month: "2020-02", shopeeAds: "99999" }), admin);
  const data = await service.getMonth({ month: "2020-01" });
  assert.deepEqual(data.totals, { shopeeAds: 30000, tiktokAds: 5000 });
  assert.equal(data.entries.length, 2);
  assert.equal(state.entries.length, 3);
  assert.equal(state.entries[1].note, "Đợt 2");
  assert.equal(state.entries[1].closedBy, admin._id);
  assert.ok(state.entries[1].closedAt instanceof Date);
});

test("gửi lại hoặc gửi đồng thời một form không cộng trùng chi phí", async (t) => {
  const state = fixture(t);
  const data = body();
  const results = await Promise.all([service.close(data, admin), service.close(data, admin)]);
  assert.equal(state.entries.length, 1);
  assert.equal(results.filter((row) => row.alreadySaved).length, 1);
  assert.equal((await service.close(data, admin)).alreadySaved, true);
  assert.equal((await service.getMonth({ month: data.month })).totals.shopeeAds, 10000);
});

test("phân trang lịch sử Ads nhưng tổng tiền tháng và lợi nhuận vẫn cộng mọi lần chốt", async (t) => {
  fixture(t);
  for (let index = 0; index < 25; index++) await service.close(body(), admin);
  await service.close(body({ month: "2020-02" }), admin);
  const data = await service.getMonth({ month: "2020-01", page: 2 });
  assert.equal(data.entries.length, 5);
  assert.equal(data.total, 25);
  assert.equal(data.page, 2);
  assert.deepEqual(data.totals, { shopeeAds: 250000, tiktokAds: 125000 });
  assert.equal((await getMonthlyReport("2020-01")).totals.adsCost, 375000);
  assert.equal((await service.getMonth({ month: "2020-01", page: 999 })).page, 2);
  const html = await ejs.renderFile(path.join(__dirname, "../views/pages/inventory/ads.ejs"), { ...data, csrfToken: "csrf", money: String, dateTime: String });
  assert.match(html, /Trang 2 \/ 2/);
  assert.match(html, /page=1&amp;month=2020-01#ads-history/);
  assert.match(html, /250000/);
});

test("cùng mã form nhưng thay tháng, tiền, ghi chú hoặc người chốt phải tải lại", async (t) => {
  const state = fixture(t);
  const data = body();
  await service.close(data, admin);
  for (const changes of [{ month: "2020-02" }, { shopeeAds: "9999" }, { tiktokAds: "9999" }, { note: "khác" }]) {
    await assert.rejects(service.close({ ...data, ...changes }, admin), /nội dung khác/);
  }
  await assert.rejects(service.close(data, { ...admin, _id: new mongoose.Types.ObjectId().toString() }), /nội dung khác/);
  assert.equal(state.entries.length, 1);
});

test("tháng không có đơn vẫn ghi Ads và tính lỗ, nhập 0 được ghi nhận rõ", async (t) => {
  fixture(t);
  assert.equal((await getMonthlyReport("2020-01")).adsRecorded, false);
  await service.close(body({ shopeeAds: 0, tiktokAds: 0 }), admin);
  assert.equal((await getMonthlyReport("2020-01")).adsRecorded, true);
  await service.close(body(), admin);
  const report = await getMonthlyReport("2020-01");
  assert.equal(report.totals.profit, -15000);
  assert.equal(report.byPlatform.shopee.profit, -10000);
  assert.equal(report.byDay.length, 0);
});

test("báo cáo chỉ lấy Ads của tháng được chọn và phiếu đúng ranh giới tháng", async (t) => {
  const state = fixture(t);
  const sale = { type: "export", approvalStatus: "approved", platform: "shopee", source: "form",
    items: [{ amount: 1, saleSnapshot: { unitRevenue: 100000, unitCostBeforeAds: 65000 } }] };
  state.movements.push(...["2019-12-31T23:59:59Z", "2020-01-01", "2020-01-31T23:59:59Z", "2020-02-01"].map(date => ({ ...sale, date: new Date(date) })));
  await service.close(body(), admin);
  await service.close(body({ shopeeAds: "5000", tiktokAds: "0" }), admin);
  await service.close(body({ month: "2020-02", shopeeAds: "9999" }), admin);
  const data = await service.getMonth({ month: "2020-01" });
  const report = await getMonthlyReport("2020-01");
  assert.deepEqual(data.totals, { shopeeAds: 15000, tiktokAds: 5000 });
  assert.equal(report.totals.adsCost, data.totals.shopeeAds + data.totals.tiktokAds);
  assert.equal(report.totals.profit, 50000);
  assert.equal(report.totals.orders, 2);
  assert.equal(report.byDay[0].profit, 35000);
  assert.deepEqual(monthRange("2020-12"), { $gte: new Date("2020-12-01"), $lt: new Date("2021-01-01") });
});

test("chốt Ads kiểm tra số tiền nguyên không âm, tháng, ghi chú, mã form và quyền admin", async (t) => {
  const state = fixture(t);
  for (const value of [undefined, null, "", " ", -1, 1.5, "abc", true, [], {}, 1e13, Infinity]) {
    for (const key of ["shopeeAds", "tiktokAds"]) await assert.rejects(service.close(body({ [key]: value }), admin));
  }
  for (const month of [undefined, "", "2020-00", "2020-13", "2020-1", "2020-01-01", "9999-12", ["2020-01"]]) {
    await assert.rejects(service.close(body({ month }), admin));
  }
  await assert.rejects(service.close(body({ note: "x".repeat(501) }), admin));
  await assert.rejects(service.close(body({ requestId: "invalid" }), admin));
  await assert.rejects(service.close(body(), { role: "staff" }), /Chỉ quản trị viên/);
  await assert.rejects(service.close(body(), null), /Chỉ quản trị viên/);
  assert.equal(state.entries.length, 0);
});

test("lỗi lưu không thay các khoản Ads trước đó và cho phép thử lại form", async (t) => {
  const state = fixture(t);
  await service.close(body(), admin);
  const next = body();
  state.fail = true;
  await assert.rejects(service.close(next, admin), /Lỗi lưu Ads/);
  assert.equal(state.entries.length, 1);
  state.fail = false;
  await service.close(next, admin);
  assert.equal(state.entries.length, 2);
});

test("model cho nhiều bản chốt cùng tháng, mã yêu cầu duy nhất và kiểm tra tiền", () => {
  const indexes = MonthlyAdsClosing.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.requestId === 1 && options.unique));
  assert.ok(!indexes.some(([keys, options]) => keys.month === 1 && options.unique));
  const entry = new MonthlyAdsClosing({ ...body(), closedBy: admin._id, closedAt: new Date() });
  assert.ifError(entry.validateSync());
  entry.shopeeAds = -1;
  assert.ok(entry.validateSync());
  entry.shopeeAds = 1.5;
  assert.ok(entry.validateSync());
});

test("form Ads cho chọn tháng, hiện lịch sử và thoát ghi chú", async (t) => {
  fixture(t);
  await service.close(body({ note: "<script>bad()</script>" }), admin);
  const data = await service.getMonth({ month: "2020-01" });
  const html = await ejs.renderFile(path.join(__dirname, "../views/pages/inventory/ads.ejs"), { ...data, csrfToken: "csrf", money: String, dateTime: String });
  assert.match(html, /type="month" name="month"/);
  assert.match(html, /name="requestId"/);
  assert.match(html, /name="shopeeAds"/);
  assert.match(html, /Lịch sử chốt Ads tháng 2020-01/);
  assert.match(html, /10000/);
  assert.match(html, /&lt;script&gt;bad/);
  assert.doesNotMatch(html, /<script>/);
});

test("route Ads bảo vệ đọc, ghi cho admin và chuyển về đúng tháng sau khi lưu", async (t) => {
  const router = require("../routes/inventoryRoutes");
  t.mock.method(service, "getMonth", async () => ({ month: "2020-01" }));
  t.mock.method(service, "close", async () => ({ month: "2020-01", alreadySaved: false }));
  const request = (method, role) => new Promise((resolve, reject) => {
    router.handle({ method, url: "/ads", query: {}, body: {}, user: role ? { role } : null }, {
      redirect: (location) => resolve({ location }), render: (view) => resolve({ view })
    }, (error) => error ? reject(error) : resolve({ missing: true }));
  });
  for (const method of ["GET", "POST"]) {
    assert.equal((await request(method)).location, "/auth/login");
    assert.match((await request(method, "staff")).location, /^\/dashboard\?error=/);
  }
  assert.equal((await request("GET", "admin")).view, "pages/inventory/ads");
  assert.match((await request("POST", "admin")).location, /^\/inventory\/ads\?month=2020-01&message=/);
});
