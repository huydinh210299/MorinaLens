const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ejs = require("ejs");
const mongoose = require("mongoose");
const Movement = require("../models/ImportAndExport");
const DailyClosing = require("../models/DailyClosing");
const Product = require("../models/Product");
const User = require("../models/User");
const service = require("../services/dailyClosingService");
const { getMonthlyReport } = require("../services/revenueService");

const admin = { _id: new mongoose.Types.ObjectId().toString(), role: "admin" };
const day = "2020-01-02";
function movement(type = "export", date = day) {
  return { _id: new mongoose.Types.ObjectId().toString(), date: new Date(date), type, platform: "shopee", requiresApproval: true,
    approvalStatus: "pending", approvedBy: null, approvedAt: null, approvalBatch: null, createdBy: admin._id,
    items: [{ sku: "LENS-01", amount: 2, saleSnapshot: { unitRevenue: 100000, unitCostBeforeAds: 65000 } }], updatedAt: new Date("2020-01-02T08:00:00Z") };
}
function fixture(t, rows = [movement(), movement("import"), movement("return")]) {
  const state = { rows, closing: null, failAfter: null };
  const originalDb = mongoose.connection.db;
  mongoose.connection.db = { admin: () => ({ command: async () => ({}) }) };
  t.after(() => { mongoose.connection.db = originalDb; });
  const query = (data) => ({
    session() { return this; }, sort() { return this; },
    populate(field) {
      if (field === "createdBy") data = data.map((row) => ({ ...row, createdBy: { _id: row.createdBy, username: "admin" } }));
      if (field === "closedBy" && data) data = { ...data, closedBy: { _id: data.closedBy, username: "admin" } };
      return this;
    },
    lean: async () => structuredClone(data)
  });
  const matches = (row, filter) => {
    if (filter.date && !(row.date >= filter.date.$gte && row.date < filter.date.$lt)) return false;
    return !filter.approvalStatus || row.approvalStatus === filter.approvalStatus;
  };
  t.mock.method(Movement, "find", (filter) => query(state.rows.filter((row) => matches(row, filter))));
  t.mock.method(Movement, "countDocuments", async (filter) => state.rows.filter((row) => matches(row, filter)).length);
  t.mock.method(DailyClosing, "find", () => query(state.closing ? [state.closing] : []));
  t.mock.method(DailyClosing, "findOne", () => query(state.closing));
  t.mock.method(DailyClosing, "findOneAndUpdate", async (_filter, update) => {
    state.closing = { _id: state.closing?._id || new mongoose.Types.ObjectId().toString(), ...update.$set, updatedAt: new Date() };
    return state.closing;
  });
  t.mock.method(DailyClosing, "deleteOne", async (filter) => {
    if (state.closing?.batchId === filter.batchId) state.closing = null;
  });
  t.mock.method(DailyClosing.collection, "replaceOne", async (filter, previous) => {
    if (state.closing?.batchId === filter.batchId) state.closing = structuredClone(previous);
  });
  t.mock.method(Movement, "updateMany", async (filter, update) => {
    let modifiedCount = 0;
    for (const row of state.rows) {
      if (!filter._id.$in.includes(row._id) || row.approvalStatus !== filter.approvalStatus) continue;
      Object.assign(row, update.$set);
      modifiedCount++;
      if (state.failAfter === modifiedCount) throw new Error("Lỗi ghi phiếu giả lập");
    }
    return { modifiedCount };
  });
  t.mock.method(Movement, "bulkWrite", async (writes) => {
    for (const { updateOne: { filter, update } } of writes) {
      const row = state.rows.find((item) => item._id === filter._id && item.approvalBatch === filter.approvalBatch);
      if (row) Object.assign(row, update.$set);
    }
  });
  t.mock.method(Product, "findOneAndUpdate", () => { throw new Error("Chốt ngày không được sửa tồn kho"); });
  t.mock.method(User, "findById", () => { throw new Error("Chốt ngày không được cộng công"); });
  return state;
}
async function formData(overrides = {}) {
  const data = await service.getDay({ date: day });
  return { date: day, shopeeAds: "10000", tiktokAds: "5000", reviewVersion: data.reviewVersion, ...overrides };
}

test("chốt ngày duyệt tất cả loại phiếu đúng ngày và lưu Ads thực tế, không đổi tồn hoặc công", async (t) => {
  const otherDay = movement("export", "2020-01-03");
  const state = fixture(t, [movement(), movement("import"), movement("return"), otherDay]);
  const result = await service.close(await formData(), admin);
  assert.equal(result.approvedCount, 3);
  assert.equal(state.closing.shopeeAds, 10000);
  assert.equal(state.closing.tiktokAds, 5000);
  for (const row of state.rows.slice(0, 3)) {
    assert.equal(row.approvalStatus, "approved");
    assert.equal(row.approvedBy, admin._id);
    assert.equal(row.approvalBatch, state.closing.batchId);
  }
  assert.equal(otherDay.approvalStatus, "pending");
  const report = await getMonthlyReport("2020-01");
  assert.equal(report.totals.profit, 55000);
  assert.equal(report.pendingCount, 1);
});

test("chốt lại ngày thay tổng Ads, không cộng dồn, duyệt thêm phiếu phát sinh", async (t) => {
  const state = fixture(t);
  const originalForm = await formData();
  await service.close(originalForm, admin);
  await assert.rejects(service.close(originalForm, admin), /đã thay đổi/);
  state.rows.push(movement());
  assert.equal((await service.close(await formData({ shopeeAds: "12000", tiktokAds: "0" }), admin)).approvedCount, 1);
  assert.equal(state.closing.shopeeAds, 12000);
  assert.equal(state.closing.tiktokAds, 0);
  assert.equal(state.rows.filter((row) => row.approvalStatus === "pending").length, 0);
});

test("chặn duyệt khi có phiếu mới hoặc phiếu bị sửa sau lúc mở trang", async (t) => {
  const state = fixture(t);
  const body = await formData();
  state.rows[0].items[0].amount = 9;
  await assert.rejects(service.close(body, admin), /đã thay đổi/);
  const fresh = await formData();
  state.rows.push(movement());
  await assert.rejects(service.close(fresh, admin), /đã thay đổi/);
  assert.equal(state.closing, null);
});

test("ghi Ads được cả khi không có phiếu, cho phép nhập rõ 0", async (t) => {
  const state = fixture(t, []);
  const result = await service.close(await formData({ shopeeAds: 0, tiktokAds: 0 }), admin);
  assert.equal(result.approvedCount, 0);
  assert.equal(state.closing.shopeeAds, 0);
});

test("bắt buộc nhập Ads hợp lệ, ngày thực, không tương lai và chỉ admin được chốt", async (t) => {
  fixture(t);
  const body = await formData();
  for (const value of [undefined, "", " ", -1, 1.5, "abc", true, [], 1e13]) {
    await assert.rejects(service.close({ ...body, shopeeAds: value }, admin));
    await assert.rejects(service.close({ ...body, tiktokAds: value }, admin));
  }
  for (const date of ["2020-02-30", "9999-12-31", "2020-1-2"]) await assert.rejects(service.close({ ...body, date }, admin));
  await assert.rejects(service.close(body, { role: "staff" }), /Chỉ quản trị viên/);
  await assert.rejects(service.close({ ...body, note: "x".repeat(501) }, admin));
});

test("lỗi giữa lúc duyệt hoàn tác toàn bộ phiếu và Ads trên MongoDB standalone", async (t) => {
  const state = fixture(t);
  const before = structuredClone(state.rows);
  state.failAfter = 1;
  await assert.rejects(service.close(await formData(), admin), /Lỗi ghi phiếu/);
  assert.deepEqual(state.rows, before);
  assert.equal(state.closing, null);
  state.failAfter = null;
  await service.close(await formData(), admin);
  const oldClosing = structuredClone(state.closing);
  state.rows.push(movement());
  state.failAfter = 1;
  await assert.rejects(service.close(await formData({ shopeeAds: 99999 }), admin));
  assert.deepEqual(state.closing, oldClosing);
  assert.equal(state.rows.at(-1).approvalStatus, "pending");
});

test("danh sách chốt ngày có phân trang nhưng duyệt đủ các trang", async (t) => {
  const state = fixture(t, Array.from({ length: 25 }, () => movement()));
  const data = await service.getDay({ date: day, page: 2 });
  assert.equal(data.total, 25);
  assert.equal(data.items.length, 5);
  await service.close(await formData(), admin);
  assert.equal(state.rows.filter((row) => row.approvalStatus === "approved").length, 25);
});

test("chốt đồng thời cùng bản xem trước chỉ ghi nhận một lần", async (t) => {
  const state = fixture(t);
  const body = await formData();
  const results = await Promise.allSettled([service.close(body, admin), service.close(body, admin)]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(state.closing.shopeeAds, 10000);
});

test("bảng chốt ngày có khóa duy nhất theo ngày và kiểm tra số tiền nguyên không âm", () => {
  assert.ok(DailyClosing.schema.indexes().some(([keys, options]) => keys.date === 1 && options.unique));
  const row = new DailyClosing({ date: day, shopeeAds: 0, tiktokAds: 0, closedBy: admin._id, closedAt: new Date(), batchId: "batch" });
  assert.ifError(row.validateSync());
  row.shopeeAds = -1;
  assert.ok(row.validateSync());
  row.shopeeAds = 1.5;
  assert.ok(row.validateSync());
});

test("trang chốt ngày và báo cáo hiện tiền thực tế, ngày thiếu Ads và thoát ghi chú", async (t) => {
  fixture(t);
  const data = await service.getDay({ date: day });
  data.items[0].note = "<script>bad()</script>";
  const helpers = { csrfToken: "token", money: String, dateTime: String };
  const html = await ejs.renderFile(path.join(__dirname, "../views/pages/inventory/closing.ejs"), { ...helpers, ...data });
  assert.match(html, /name="shopeeAds"/);
  assert.match(html, /name="tiktokAds"/);
  assert.match(html, /name="reviewVersion"/);
  assert.ok(!html.includes("<script>bad"));
  const report = await getMonthlyReport("2020-01");
  const reportHtml = await ejs.renderFile(path.join(__dirname, "../views/pages/revenue/index.ejs"), { ...helpers, month: "2020-01", report });
  assert.match(reportHtml, /Tiền quảng cáo thực tế/);
  assert.match(reportHtml, /phiếu kho đang chờ duyệt/);
});

test("route chốt ngày bảo vệ cả đọc và ghi cho admin, không còn duyệt lẻ", async (t) => {
  const router = require("../routes/inventoryRoutes");
  t.mock.method(service, "getDay", async () => ({ total: 1 }));
  const request = (method, role, url = "/closing") => new Promise((resolve, reject) => {
    router.handle({ method, url, query: {}, body: {}, user: role ? { role } : null }, {
      redirect: (location) => resolve({ location }), render: (view) => resolve({ view })
    }, (error) => error ? reject(error) : resolve({ missing: true }));
  });
  for (const method of ["GET", "POST"]) {
    assert.equal((await request(method)).location, "/auth/login");
    assert.match((await request(method, "staff")).location, /^\/dashboard\?error=/);
  }
  assert.equal((await request("GET", "admin")).view, "pages/inventory/closing");
  assert.equal((await request("POST", "admin", "/some-id/approve")).missing, true);
});
