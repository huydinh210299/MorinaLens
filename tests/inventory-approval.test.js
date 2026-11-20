const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ejs = require("ejs");
const mongoose = require("mongoose");
const Movement = require("../models/ImportAndExport");
const InventoryApproval = require("../models/InventoryApproval");
const Product = require("../models/Product");
const User = require("../models/User");
const service = require("../services/inventoryApprovalService");
const { getMonthlyReport } = require("../services/revenueService");

const admin = { _id: new mongoose.Types.ObjectId().toString(), role: "admin" };
const day = "2020-01-02";
function movement(type = "export", date = day) {
  return { _id: new mongoose.Types.ObjectId().toString(), date: new Date(date), type, platform: "shopee", requiresApproval: true,
    approvalStatus: "pending", approvedBy: null, approvedAt: null, approvalBatch: null, createdBy: admin._id,
    items: [{ sku: "LENS-01", amount: 2, saleSnapshot: { unitRevenue: 100000, unitCostBeforeAds: 65000 } }], updatedAt: new Date("2020-01-02T08:00:00Z") };
}
function fixture(t, rows = [movement(), movement("import"), movement("return")]) {
  const state = { rows, approvals: [], failAfter: null, failApprovalAfter: null };
  Object.defineProperty(state, "approval", { get: () => state.approvals.at(-1) || null });
  const originalDb = mongoose.connection.db;
  mongoose.connection.db = { admin: () => ({ command: async () => ({}) }) };
  t.after(() => { mongoose.connection.db = originalDb; });
  const query = (data) => ({
    session() { return this; }, sort() { return this; }, select() { return this; },
    populate(field) {
      if (field.includes("createdBy")) data = data.map((row) => ({ ...row, createdBy: { _id: row.createdBy, username: "admin" } }));
      if (field.includes("approvedBy")) data = data.map((row) => ({ ...row, approvedBy: row.approvedBy ? { _id: row.approvedBy, username: "reviewer" } : null }));
      if (field === "reviewedBy") data = data.map((row) => ({ ...row, reviewedBy: { _id: row.reviewedBy, username: "admin" } }));
      return this;
    },
    lean: async () => structuredClone(data)
  });
  const matches = (row, filter) => {
    if (filter.date && !(row.date >= filter.date.$gte && row.date < filter.date.$lt)) return false;
    if (filter.type && row.type !== filter.type) return false;
    if (filter.platform && row.platform !== filter.platform) return false;
    return !filter.approvalStatus || row.approvalStatus === filter.approvalStatus;
  };
  t.mock.method(Movement, "find", (filter) => query(state.rows.filter((row) => matches(row, filter))));
  t.mock.method(Movement, "countDocuments", async (filter) => state.rows.filter((row) => matches(row, filter)).length);
  const sameDay = (row, filter) => !filter.date || row.date.getTime() === filter.date.getTime();
  t.mock.method(InventoryApproval, "find", (filter) => query(state.approvals.filter((row) => sameDay(row, filter))));
  t.mock.method(InventoryApproval, "findOneAndUpdate", async (filter, update) => {
    const previous = state.approvals.find((row) => sameDay(row, filter));
    if (previous) Object.assign(previous, update.$set, { updatedAt: new Date() });
    else state.approvals.push({ _id: new mongoose.Types.ObjectId().toString(), ...update.$set, updatedAt: new Date() });
    if (state.failApprovalAfter !== null && --state.failApprovalAfter === 0) throw new Error("Lỗi lưu bản duyệt giả lập");
    return previous || state.approval;
  });
  t.mock.method(InventoryApproval, "deleteOne", async (filter) => {
    state.approvals = state.approvals.filter((row) => !(sameDay(row, filter) && row.batchId === filter.batchId));
  });
  t.mock.method(InventoryApproval.collection, "replaceOne", async (filter, previous) => {
    const index = state.approvals.findIndex((row) => sameDay(row, filter) && row.batchId === filter.batchId);
    if (index >= 0) state.approvals[index] = structuredClone(previous);
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
  t.mock.method(Product, "findOneAndUpdate", () => { throw new Error("Duyệt kho không được sửa tồn kho"); });
  t.mock.method(User, "findById", () => { throw new Error("Duyệt kho không được cộng công"); });
  return state;
}
async function formData(overrides = {}) {
  const date = overrides.date ?? day;
  const data = await service.getReview({ ...overrides, date });
  return { date, reviewVersion: data.reviewVersion, ...overrides };
}

test("duyệt tất cả loại phiếu đúng ngày, không ghi Ads, không đổi tồn hoặc công", async (t) => {
  const otherDay = movement("export", "2020-01-03");
  const state = fixture(t, [movement(), movement("import"), movement("return"), otherDay]);
  const result = await service.approve(await formData(), admin);
  assert.equal(result.approvedCount, 3);
  assert.equal(state.approval.reviewedBy, admin._id);
  assert.ok(state.approval.reviewedAt instanceof Date);
  assert.equal("shopeeAds" in state.approval, false);
  assert.equal("tiktokAds" in state.approval, false);
  for (const row of state.rows.slice(0, 3)) {
    assert.equal(row.approvalStatus, "approved");
    assert.equal(row.approvedBy, admin._id);
    assert.equal(row.approvalBatch, state.approval.batchId);
  }
  assert.equal(otherDay.approvalStatus, "pending");
  const report = await getMonthlyReport("2020-01");
  assert.equal(report.totals.profit, 70000);
  assert.equal(report.adsRecorded, undefined);
  assert.equal(report.pendingCount, 1);
});

test("duyệt thêm phiếu phát sinh, không duyệt trùng bằng bản xem trước cũ", async (t) => {
  const state = fixture(t);
  const originalForm = await formData();
  await service.approve(originalForm, admin);
  await assert.rejects(service.approve(originalForm, admin), /đã thay đổi/);
  state.rows.push(movement());
  assert.equal((await service.approve(await formData({ note: "Duyệt thêm" }), admin)).approvedCount, 1);
  assert.equal(state.approval.note, "Duyệt thêm");
  assert.equal((await getMonthlyReport("2020-01")).totals.profit, 140000);
  assert.equal(state.rows.filter((row) => row.approvalStatus === "pending").length, 0);
});

test("chặn duyệt khi có phiếu mới hoặc phiếu bị sửa sau lúc mở trang", async (t) => {
  const state = fixture(t);
  const body = await formData();
  state.rows[0].items[0].amount = 9;
  await assert.rejects(service.approve(body, admin), /đã thay đổi/);
  const fresh = await formData();
  state.rows.push(movement());
  await assert.rejects(service.approve(fresh, admin), /đã thay đổi/);
  assert.equal(state.approval, null);
});

test("duyệt kho không có phiếu giữ báo cáo rỗng", async (t) => {
  const state = fixture(t, []);
  const result = await service.approve(await formData(), admin);
  assert.equal(result.approvedCount, 0);
  assert.equal(state.approval, null);
  assert.equal((await getMonthlyReport("2020-01")).totals.profit, 0);
});

test("duyệt kho kiểm tra ngày thực, không tương lai, chỉ admin và ghi chú hợp lệ", async (t) => {
  fixture(t);
  const body = await formData();
  for (const date of ["2020-02-30", "9999-12-31", "2020-1-2"]) await assert.rejects(service.approve({ ...body, date }, admin));
  await assert.rejects(service.approve(body, { role: "staff" }), /Chỉ quản trị viên/);
  await assert.rejects(service.approve({ ...body, note: "x".repeat(501) }, admin));
});

test("lỗi giữa lúc duyệt hoàn tác toàn bộ phiếu và bản ghi duyệt trên MongoDB standalone", async (t) => {
  const state = fixture(t);
  const before = structuredClone(state.rows);
  state.failAfter = 1;
  await assert.rejects(service.approve(await formData(), admin), /Lỗi ghi phiếu/);
  assert.deepEqual(state.rows, before);
  assert.equal(state.approval, null);
  state.failAfter = null;
  await service.approve(await formData(), admin);
  const oldApproval = structuredClone(state.approval);
  state.rows.push(movement());
  state.failAfter = 1;
  await assert.rejects(service.approve(await formData({ note: "Lần mới" }), admin));
  assert.deepEqual(state.approval, oldApproval);
  assert.equal(state.rows.at(-1).approvalStatus, "pending");
});

test("danh sách duyệt kho có phân trang nhưng duyệt đủ các trang", async (t) => {
  const state = fixture(t, Array.from({ length: 25 }, () => movement()));
  const data = await service.getReview({ date: day, page: 2 });
  assert.equal(data.total, 25);
  assert.equal(data.items.length, 5);
  await service.approve(await formData(), admin);
  assert.equal(state.rows.filter((row) => row.approvalStatus === "approved").length, 25);
});

test("mặc định xem tất cả các ngày, để trống ngày bỏ lọc, chỉ lọc khi chọn ngày", async (t) => {
  const approved = { ...movement("export", "2019-12-31"), approvalStatus: "approved" };
  fixture(t, [movement(), movement("import", "2020-01-03"), movement("return", "2019-12-31"), approved]);
  const all = await service.getReview();
  assert.equal(all.date, "");
  assert.equal(all.total, 4);
  assert.equal(all.pendingCount, 3);
  assert.equal(all.approvedCount, 1);
  assert.deepEqual(all.counts, { import: 1, export: 1, return: 1 });
  assert.equal((await service.getReview({ date: "" })).total, 4);
  const filtered = await service.getReview({ date: "2019-12-31" });
  assert.equal(filtered.total, 2);
  assert.equal(filtered.pendingCount, 1);
  assert.equal(filtered.approvedCount, 1);
  assert.equal(filtered.items[0].type, "return");
});

test("lọc Tất cả, Chờ duyệt và Đã duyệt cùng ngày, loại phiếu và sàn", async (t) => {
  const approved = { ...movement(), approvalStatus: "approved", approvedBy: admin._id, approvedAt: new Date() };
  fixture(t, [movement(), approved, movement("import"), { ...movement(), platform: "tiktok" }, movement("export", "2020-01-03")]);
  assert.equal((await service.getReview()).total, 5);
  const filters = { date: day, type: "export", platform: "shopee" };
  const all = await service.getReview(filters);
  assert.equal(all.total, 2);
  assert.equal(all.pendingCount, 1);
  assert.equal(all.approvedCount, 1);
  const pending = await service.getReview({ ...filters, status: "pending" });
  assert.equal(pending.total, 1);
  assert.equal(pending.items[0].approvalStatus, "pending");
  const done = await service.getReview({ ...filters, status: "approved" });
  assert.equal(done.total, 1);
  assert.equal(done.pendingCount, 0);
  assert.equal(done.items[0].approvedBy.username, "reviewer");
});

test("duyệt ngay trong danh sách chỉ đổi phiếu chờ khớp bộ lọc, giữ phiếu đã duyệt", async (t) => {
  const approved = { ...movement(), approvalStatus: "approved", approvedBy: admin._id, approvedAt: new Date("2020-01-01"), approvalBatch: "previous" };
  const state = fixture(t, [movement(), approved, movement("import"), { ...movement(), platform: "tiktok" }, movement("export", "2020-01-03")]);
  const before = structuredClone(state.rows.slice(1));
  const filters = { date: day, type: "export", platform: "shopee" };
  const result = await service.approve(await formData(filters), admin);
  assert.equal(result.approvedCount, 1);
  assert.equal(state.rows[0].approvalStatus, "approved");
  assert.deepEqual(state.rows.slice(1), before);
  assert.equal((await service.getReview(filters)).approvedCount, 2);
});

test("chặn đổi phạm vi trạng thái, loại và sàn sau khi mở trang duyệt", async (t) => {
  const state = fixture(t, [movement()]);
  const data = await formData({ type: "export", platform: "shopee", status: "pending" });
  for (const key of ["type", "platform", "status"]) {
    await assert.rejects(service.approve({ ...data, [key]: "" }, admin), /đã thay đổi/);
  }
  for (const [key, values] of Object.entries({ status: ["invalid", ["pending"]], type: ["invalid", ["export"]], platform: ["invalid", ["shopee"]] })) {
    for (const value of values) {
      await assert.rejects(service.getReview({ [key]: value }), /không hợp lệ/);
      await assert.rejects(service.approve({ ...data, [key]: value }, admin), /không hợp lệ/);
    }
  }
  const done = await service.getReview({ status: "approved" });
  await assert.rejects(service.approve({ status: "approved", reviewVersion: done.reviewVersion }, admin), /Đang lọc phiếu đã duyệt/);
  assert.equal(state.rows[0].approvalStatus, "pending");
  assert.equal(state.approvals.length, 0);
});

test("dropdown, nhãn trạng thái và phân trang của trang kho giữ đầy đủ bộ lọc", async (t) => {
  const approved = { ...movement(), approvalStatus: "approved", approvedBy: admin._id, approvedAt: new Date("2020-01-02") };
  fixture(t, [...Array.from({ length: 25 }, () => movement()), ...Array.from({ length: 25 }, () => ({ ...approved, _id: new mongoose.Types.ObjectId().toString() }))]);
  const helpers = { currentUser: admin, csrfToken: "csrf", dateTime: String, dateOnly: String };
  const render = async filters => ejs.renderFile(path.join(__dirname, "../views/pages/inventory/index.ejs"), { ...helpers, ...await service.getReview(filters) });
  const all = await render({});
  assert.match(all, /name="status"/);
  assert.match(all, /value="" selected>Tất cả/);
  assert.match(all, /Duyệt 25 phiếu chờ/);
  const filters = { date: day, status: "approved", type: "export", platform: "shopee" };
  const done = await render(filters);
  assert.match(done, /value="approved" selected>Đã duyệt/);
  assert.match(done, /class="badge approved"/);
  assert.match(done, /reviewer/);
  assert.doesNotMatch(done, /action="\/inventory\/approve"/);
  assert.match(done.replaceAll('&amp;', '&'), /href="\/inventory\?page=2&date=2020-01-02&type=export&platform=shopee&status=approved"/);
  const pending = await render({ ...filters, status: "pending" });
  assert.match(pending, /class="badge pending"/);
  assert.match(pending, /action="\/inventory\/approve"/);
  assert.match(pending, /name="platform" value="shopee"/);
});

test("duyệt tất cả nhiều ngày và mọi trang, giữ lịch sử theo đúng ngày nghiệp vụ", async (t) => {
  const state = fixture(t, Array.from({ length: 25 }, (_, index) => movement("export", index % 2 ? day : "2020-01-03")));
  const data = await service.getReview({ page: 2 });
  assert.equal(data.items.length, 5);
  const result = await service.approve({ date: "", reviewVersion: data.reviewVersion, note: "Duyệt toàn bộ" }, admin);
  assert.equal(result.date, "");
  assert.equal(result.approvedCount, 25);
  assert.equal(state.approvals.length, 2);
  assert.equal(new Set(state.approvals.map(row => row.batchId)).size, 1);
  for (const row of state.rows) {
    const approval = state.approvals.find(approval => approval.date.getTime() === row.date.getTime());
    assert.equal(row.approvalBatch, approval.batchId);
    assert.equal(row.approvalStatus, "approved");
    assert.equal(approval.note, "Duyệt toàn bộ");
  }
});

test("không dùng bản xem trước của một ngày để duyệt tất cả hoặc ngược lại", async (t) => {
  const state = fixture(t);
  const filtered = await formData();
  await assert.rejects(service.approve({ ...filtered, date: "" }, admin), /đã thay đổi/);
  const all = await formData({ date: "" });
  await assert.rejects(service.approve({ ...all, date: day }, admin), /đã thay đổi/);
  state.rows.push(movement("export", "2020-01-03"));
  await assert.rejects(service.approve(all, admin), /đã thay đổi/);
  assert.equal(state.approvals.length, 0);
});

test("lỗi duyệt nhiều ngày hoàn tác cả bản ghi ngày cũ lẫn ngày mới", async (t) => {
  const state = fixture(t, [movement()]);
  await service.approve(await formData(), admin);
  state.rows.push(movement(), movement("import", "2020-01-03"));
  const before = structuredClone({ rows: state.rows, approvals: state.approvals });
  state.failAfter = 1;
  await assert.rejects(service.approve(await formData({ date: "" }), admin), /Lỗi ghi phiếu/);
  assert.deepEqual({ rows: state.rows, approvals: state.approvals }, before);
});

test("lỗi lưu bản duyệt ngày thứ hai xóa mọi bản ghi của lần thử, không duyệt phiếu", async (t) => {
  const state = fixture(t, [movement(), movement("return", "2020-01-03")]);
  const before = structuredClone(state.rows);
  state.failApprovalAfter = 2;
  await assert.rejects(service.approve(await formData({ date: "" }), admin), /Lỗi lưu bản duyệt/);
  assert.deepEqual(state.rows, before);
  assert.equal(state.approvals.length, 0);
});

test("không duyệt phiếu tương lai trong phạm vi tất cả", async (t) => {
  const state = fixture(t, [movement(), movement("export", "9999-12-31")]);
  const all = await service.getReview();
  assert.equal(all.total, 2);
  await assert.rejects(service.approve({ reviewVersion: all.reviewVersion }, admin), /tương lai/);
  assert.equal(state.approvals.length, 0);
  assert.ok(state.rows.every(row => row.approvalStatus === "pending"));
});

test("giao diện xem tất cả có ngày từng phiếu, bỏ lọc và phân trang đúng phạm vi", async (t) => {
  fixture(t, Array.from({ length: 25 }, (_, index) => movement("export", index % 2 ? day : "2020-01-03")));
  const helpers = { currentUser: admin, csrfToken: "token", dateTime: String, dateOnly: value => new Date(value).toISOString().slice(0, 10).split('-').reverse().join('/') };
  const render = async (query) => ejs.renderFile(path.join(__dirname, "../views/pages/inventory/index.ejs"), { ...helpers, ...await service.getReview(query) });
  const all = await render({});
  assert.match(all, /Xem tất cả/);
  assert.match(all, /03\/01\/2020/);
  assert.match(all, /02\/01\/2020/);
  assert.match(all, /Duyệt 25 phiếu/);
  assert.match(all, /href="\/inventory\?page=2"/);
  const dateInput = all.match(/<input type="date"[^>]*>/)[0];
  assert.match(dateInput, /value=""/);
  assert.doesNotMatch(dateInput, /required/);
  const filtered = await render({ date: day });
  assert.match(filtered, /Duyệt 12 phiếu/);
  assert.doesNotMatch(filtered, /03\/01\/2020/);
});

test("duyệt đồng thời cùng bản xem trước chỉ ghi nhận một lần", async (t) => {
  const state = fixture(t);
  const body = await formData();
  const results = await Promise.allSettled([service.approve(body, admin), service.approve(body, admin)]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(state.rows.filter((row) => row.approvalStatus === "pending").length, 0);
});

test("model duyệt kho có ngày duy nhất và không chứa các trường Ads", () => {
  assert.ok(InventoryApproval.schema.indexes().some(([keys, options]) => keys.date === 1 && options.unique));
  const row = new InventoryApproval({ date: day, reviewedBy: admin._id, reviewedAt: new Date(), batchId: "batch" });
  assert.ifError(row.validateSync());
  for (const field of ["shopeeAds", "tiktokAds", "adsRecorded", "legacyAdsNote"]) assert.equal(InventoryApproval.schema.path(field), undefined);
});

test("trang duyệt kho không nhập Ads, báo cáo hiển thị lãi trước Ads và thoát ghi chú", async (t) => {
  fixture(t);
  const data = await service.getReview({ date: day });
  data.items[0].note = "<script>bad()</script>";
  const helpers = { currentUser: admin, csrfToken: "token", money: String, dateTime: String, dateOnly: String };
  const html = await ejs.renderFile(path.join(__dirname, "../views/pages/inventory/index.ejs"), { ...helpers, ...data });
  assert.doesNotMatch(html, /name="shopeeAds"/);
  assert.doesNotMatch(html, /name="tiktokAds"/);
  assert.doesNotMatch(html, /Chốt Ads|\/inventory\/ads/);
  assert.match(html, /name="reviewVersion"/);
  assert.ok(!html.includes("<script>bad"));
  const report = await getMonthlyReport("2020-01");
  const reportHtml = await ejs.renderFile(path.join(__dirname, "../views/pages/revenue/index.ejs"), { ...helpers, month: "2020-01", report,
    dailyPage: require("../utils/pagination").paginateRows(report.byDay) });
  assert.match(reportHtml, /Lãi trước Ads/);
  assert.doesNotMatch(reportHtml, /Chốt Ads|\/inventory\/ads/);
  assert.match(reportHtml, /phiếu kho đang chờ duyệt/);
});

test("một trang kho dùng chung, duyệt chỉ dành cho admin và link cũ chuyển về trang kho", async (t) => {
  const router = require("../routes/inventoryRoutes");
  t.mock.method(service, "getReview", async () => ({ total: 1 }));
  t.mock.method(service, "approve", async () => ({ date: day, status: "pending", type: "export", platform: "tiktok", approvedCount: 2 }));
  const request = (method, role, url = "/", query = {}) => new Promise((resolve, reject) => {
    router.handle({ method, url, query, body: {}, user: role ? { role } : null }, {
      redirect: (location) => resolve({ location }), render: (view) => resolve({ view })
    }, (error) => error ? reject(error) : resolve({ missing: true }));
  });
  for (const [method, url] of [["GET", "/approvals"], ["POST", "/approve"], ["POST", "/approvals"]]) {
    assert.equal((await request(method, null, url)).location, "/auth/login");
    assert.match((await request(method, "staff", url)).location, /^\/dashboard\?error=/);
  }
  for (const role of ["admin", "staff"]) assert.equal((await request("GET", role)).view, "pages/inventory/index");
  assert.equal((await request("GET", "admin", "/approvals", { date: day, status: "pending" })).location, "/inventory?date=" + day + "&status=pending");
  const saved = new URL((await request("POST", "admin", "/approve")).location, "http://localhost");
  assert.equal(saved.pathname, "/inventory");
  for (const [key, value] of Object.entries({ date: day, status: "pending", type: "export", platform: "tiktok" })) assert.equal(saved.searchParams.get(key), value);
  assert.equal((await request("POST", "admin", "/some-id/approve")).missing, true);
});
