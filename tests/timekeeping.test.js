const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const mongoose = require("mongoose");
const ejs = require("ejs");
const User = require("../models/User");
const Configuration = require("../models/Configuration");
const inventory = require("../services/inventoryService");
const service = require("../services/timekeepingService");
const { countOrders, recalculatePayroll, paidTotal } = require("../services/userService");

function fixture(t, orders = []) {
  const user = new User({ username: "staff", password: "hash", role: "staff", orders });
  t.mock.method(user, "save", async () => user);
  t.mock.method(User, "findById", (id) => ({ session: async () => String(id) === String(user._id) ? user : null }));
  t.mock.method(Configuration, "findOne", () => ({ session: () => ({ lean: async () => ({ value: 1500 }) }) }));
  t.mock.method(inventory, "runInventory", async (work) => work(null));
  return user;
}
const admin = { _id: new mongoose.Types.ObjectId(), role: "admin" };

test("ngày chấm công dùng múi giờ Việt Nam, kiểm tra ngày thực và số nguyên không âm", () => {
  assert.equal(service.today(new Date("2026-10-31T18:00:00Z")), "2026-11-01");
  assert.equal(service.parseEntry({ date: "2020-02-29", amount: "0" }).amount, 0);
  for (const date of ["2020-02-30", "2021-02-29", "2020-13-01", "2020-1-01", "2020-01-01T00:00:00Z", "9999-12-31", ""]) {
    assert.throws(() => service.parseEntry({ date, amount: 2 }));
  }
  for (const amount of ["", " ", undefined, null, [], true, -1, 1.5, "abc", 1000001]) {
    assert.throws(() => service.parseEntry({ date: "2020-01-01", amount }));
  }
  assert.throws(() => service.parseEntry({ date: "2020-01-01", amount: 1, note: "x".repeat(501) }));
});

test("nhân viên gửi công chờ duyệt, không thể tự chọn trạng thái hoặc gửi trùng ngày", async (t) => {
  const user = fixture(t);
  const month = await service.saveOwn(user._id, { date: "2020-01-02", amount: "30", approved: true, attendance: false, note: " Đóng ca sáng " });
  assert.equal(month, "2020-01");
  assert.equal(user.orders[0].attendance, true);
  assert.equal(user.orders[0].approved, false);
  assert.equal(user.orders[0].note, "Đóng ca sáng");
  assert.equal(countOrders(user, month), 0);
  assert.equal(user.payroll.length, 0);
  await assert.rejects(service.saveOwn(user._id, { date: "2020-01-02", amount: 5 }), /đã chấm công/);
  assert.equal(user.orders.length, 1);
});

test("có thể sửa, chuyển ngày và hủy công của mình khi chưa duyệt", async (t) => {
  const user = fixture(t);
  await service.saveOwn(user._id, { date: "2020-01-02", amount: 30 });
  await service.saveOwn(user._id, { date: "2020-01-03", amount: 10 });
  const id = user.orders[0]._id;
  await assert.rejects(service.saveOwn(user._id, { date: "2020-01-03", amount: 12 }, id), /đã chấm công/);
  await service.saveOwn(user._id, { date: "2020-02-01", amount: 0, note: "Không có đơn" }, id);
  assert.equal(user.orders[0].amount, 0);
  assert.equal(await service.cancelOwn(user._id, id), "2020-02");
  assert.equal(user.orders.length, 1);
});

test("duyệt tổng công thay công tự cộng cũ cùng ngày, giữ điều chỉnh và khoản lương đã trả", async (t) => {
  const user = fixture(t, [
    { date: "2020-01-02", amount: 1, movement: new mongoose.Types.ObjectId() },
    { date: "2020-01-02", amount: 1, movement: new mongoose.Types.ObjectId() },
    { date: "2020-01-02", amount: 3 },
    { date: "2020-01-03", amount: 1, movement: new mongoose.Types.ObjectId() },
    { date: "2019-12-31", amount: 10 }
  ]);
  recalculatePayroll(user, "2020-01", 1500);
  user.payroll[0].payments.push({ amount: 9000, method: "auto", orderCountAtPayment: 6,
    ratePerOrderAtPayment: 1500, paidBy: admin._id, paidAt: new Date() });
  await service.saveOwn(user._id, { date: "2020-01-02", amount: 30 });
  assert.equal(countOrders(user, "2020-01"), 6);
  const entry = user.orders.at(-1);
  await service.review(user._id, entry._id, admin, true);
  assert.equal(entry.approved, true);
  assert.equal(String(entry.approvedBy), String(admin._id));
  assert.ok(entry.approvedAt instanceof Date);
  assert.equal(countOrders(user, "2020-01"), 34);
  assert.equal(countOrders(user), 44);
  assert.equal(user.payroll[0].amount, 51000);
  assert.equal(paidTotal(user.payroll[0]), 9000);
  await assert.rejects(service.review(user._id, entry._id, admin, true), /đã duyệt/);
  await assert.rejects(service.review(user._id, entry._id, admin, false), /đã duyệt/);
  await assert.rejects(service.cancelOwn(user._id, entry._id), /đã duyệt/);
  await assert.rejects(service.saveOwn(user._id, { date: "2020-01-02", amount: 99 }, entry._id), /đã duyệt/);
});

test("duyệt 0 đơn thay tổng phiếu xuất cũ về 0 mà không thay số tiền đã trả", async (t) => {
  const user = fixture(t, [{ date: "2020-01-02", amount: 1, movement: new mongoose.Types.ObjectId() }]);
  recalculatePayroll(user, "2020-01");
  await service.saveOwn(user._id, { date: "2020-01-02", amount: 0 });
  await service.review(user._id, user.orders.at(-1)._id, admin, true);
  assert.equal(countOrders(user, "2020-01"), 0);
  assert.equal(user.payroll[0].amount, 0);
});

test("từ chối công chờ duyệt cho phép nhân viên gửi lại, không tác động lịch sử công cũ", async (t) => {
  const user = fixture(t, [{ date: "2020-01-02", amount: 1, movement: new mongoose.Types.ObjectId() }]);
  await service.saveOwn(user._id, { date: "2020-01-02", amount: 30 });
  await service.review(user._id, user.orders.at(-1)._id, admin, false);
  assert.equal(countOrders(user, "2020-01"), 1);
  await service.saveOwn(user._id, { date: "2020-01-02", amount: 20 });
  assert.equal(user.orders.length, 2);
});

test("chặn duyệt bởi staff, chặn sửa phiếu kho và chấm công tài khoản khác", async (t) => {
  const user = fixture(t, [{ date: "2020-01-02", amount: 1, movement: new mongoose.Types.ObjectId() }]);
  await assert.rejects(service.review(user._id, user.orders[0]._id, user, true), /không có quyền/);
  await assert.rejects(service.saveOwn(user._id, { date: "2020-01-02", amount: 20 }, user.orders[0]._id), /Không tìm thấy/);
  await assert.rejects(service.cancelOwn(new mongoose.Types.ObjectId(), user.orders[0]._id), /Chỉ nhân viên/);
  user.role = "admin";
  await assert.rejects(service.saveOwn(user._id, { date: "2020-01-02", amount: 1 }), /Chỉ nhân viên/);
  user.role = "staff";
  user.active = false;
  await assert.rejects(service.saveOwn(user._id, { date: "2020-01-02", amount: 1 }), /Chỉ nhân viên/);
});

test("công cũ không có trường duyệt vẫn được tính, công mới phải chờ duyệt", () => {
  assert.equal(countOrders({ orders: [
    { date: new Date("2020-01-01"), amount: 7 },
    { date: new Date("2020-01-02"), amount: 30, attendance: true, approved: false }
  ] }, "2020-01"), 7);
});

test("lọc tháng, phân trang lịch sử công và danh sách chờ duyệt", async (t) => {
  const user = new User({ username: "staff", password: "hash", orders: Array.from({ length: 25 }, (_, i) => ({
    date: new Date(Date.UTC(2020, 0, i + 1)), amount: i + 1, attendance: true, approved: false
  })) });
  user.orders.push({ date: "2019-12-31", amount: 20, attendance: true, approved: false });
  t.mock.method(User, "findById", () => ({ populate: () => ({ lean: async () => user.toObject() }) }));
  t.mock.method(User, "find", () => ({ select: () => ({ lean: async () => [user.toObject()] }) }));
  t.mock.method(Configuration, "findOne", () => ({ session: () => ({ lean: async () => ({ value: 1500 }) }) }));
  const data = await service.ownData(user._id, { month: "2020-01", page: 2 });
  assert.equal(data.total, 25);
  assert.equal(data.pendingCount, 25);
  assert.equal(data.items.length, 5);
  assert.equal(data.orderCount, 0);
  const pending = await service.pendingData({ month: "2020-01", page: 100 });
  assert.equal(pending.page, 2);
  assert.equal(pending.total, 25);
  assert.equal(pending.items.length, 5);
  assert.equal(pending.items[0].username, "staff");
});

test("trang công và duyệt công hiển thị biểu mẫu, trạng thái và thoát nội dung ghi chú", async () => {
  const locals = { month: "2020-01", today: "2020-01-03", isStaff: true, orderCount: 0, pendingCount: 1, approvedCount: 0,
    defaultOrderRate: 1500, salary: 0, paid: 0, page: 1, total: 1, limit: 20, csrfToken: "test", money: String,
    dateOnly: () => "02/01/2020", dateTime: () => "02/01/2020", dateInput: () => "2020-01-02",
    items: [{ _id: "entry", date: new Date("2020-01-02"), amount: 30, approved: false, note: "<script>alert(1)</script>", userId: "user", username: "staff" }] };
  const own = await ejs.renderFile(path.join(__dirname, "../views/pages/users/timekeeping.ejs"), locals);
  assert.match(own, /Gửi chấm công/);
  assert.match(own, /Chờ duyệt/);
  assert.match(own, /_method=PUT/);
  assert.match(own, /_csrf/);
  assert.ok(!own.includes("<script>alert"));
  const pending = await ejs.renderFile(path.join(__dirname, "../views/pages/users/pending-timekeeping.ejs"), locals);
  assert.match(pending, /\/users\/user\/timekeeping\/entry\/approve/);
  assert.match(pending, /Từ chối/);
  assert.ok(!pending.includes("<script>alert"));
  locals.items[0].approved = true;
  const approved = await ejs.renderFile(path.join(__dirname, "../views/pages/users/timekeeping.ejs"), locals);
  assert.match(approved, /Đã duyệt/);
  assert.ok(!approved.includes("_method=PUT"));
});

test("route công xác thực, giữ trang nhân sự riêng cho admin và dùng đúng người đăng nhập", async (t) => {
  const router = require("../routes/userRoutes");
  t.mock.method(service, "ownData", async (id) => ({ owner: id }));
  t.mock.method(service, "pendingData", async () => ({ total: 1 }));
  let savedOwner;
  t.mock.method(service, "saveOwn", async (id) => { savedOwner = id; return "2020-01"; });
  const request = (url, role, method = "GET", body = {}) => new Promise((resolve, reject) => {
    const req = { url, method, body, query: {}, user: role ? { _id: "logged-in-user", role } : null };
    const res = { render: (view, data) => resolve({ view, ...data }), redirect: (location) => resolve({ location }) };
    router.handle(req, res, (error) => reject(error || new Error("Không tìm thấy route")));
  });
  assert.equal((await request("/timekeeping")).location, "/auth/login");
  const own = await request("/timekeeping", "staff");
  assert.equal(own.owner, "logged-in-user");
  for (const url of ["/", "/timekeeping/pending", "/someone-else"]) {
    assert.match((await request(url, "staff")).location, /^\/dashboard\?error=/);
  }
  assert.match((await request("/someone/timekeeping/entry/approve", "staff", "POST")).location, /^\/dashboard\?error=/);
  assert.match((await request("/someone/timekeeping/entry", "staff", "DELETE")).location, /^\/dashboard\?error=/);
  assert.equal((await request("/timekeeping/pending", "admin")).view, "pages/users/pending-timekeeping");
  await request("/timekeeping", "staff", "POST", { userId: "someone-else", date: "2020-01-01", amount: 5 });
  assert.equal(savedOwner, "logged-in-user");
});
