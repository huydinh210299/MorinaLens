const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ejs = require("ejs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Movement = require("../models/ImportAndExport");
const Configuration = require("../models/Configuration");
const service = require("../services/commissionService");
const inventory = require("../services/inventoryService");
const { systemDefaults, systemKeys } = require("../utils/configuration");
const actor = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const month = "2020-01";
const query = (value) => ({ session() { return this; }, populate() { return this; }, lean: async () => value });
function fixture(t) {
  const user = new User({ username: "staff", password: "hash", role: "staff",
    payroll: [{ month, amount: 90000, payments: [] }] }).toObject();
  const movements = [{ _id: new mongoose.Types.ObjectId(), createdBy: user._id, type: "export", platform: "shopee",
    date: new Date("2020-01-31"), approvalStatus: "approved", source: "form",
    items: [{ amount: 2, saleSnapshot: { unitRevenue: 75123.45 } }] }];
  const config = { value: 1 };
  t.mock.method(User, "findById", () => query(user));
  t.mock.method(Movement, "find", () => query(movements));
  t.mock.method(Configuration, "findOne", () => query(config));
  t.mock.method(inventory, "runInventory", async (work) => work(null));
  t.mock.method(User, "updateOne", async (filter, update) => {
    assert.equal(filter["commissions.month"].$ne, month);
    if (user.commissions.some((row) => row.month === month)) return { modifiedCount: 0 };
    user.commissions.push(update.$push.commissions);
    return { modifiedCount: 1 };
  });
  return { user, movements, config };
}
test("mặc định 1%, tính doanh thu đúng nhân viên/tháng, chỉ phiếu xuất đã duyệt ở cả hai sàn", (t) => {
  const { user, movements } = fixture(t);
  assert.deepEqual(systemDefaults, [["commissionPercent", systemKeys.commissionPercent.label, 1, "percent"]]);
  const first = movements[0];
  movements.push({ ...first, _id: "tiktok", platform: "tiktok", items: [{ amount: 1, saleSnapshot: { unitRevenue: 90000 } }] },
    { ...first, _id: "other-user", createdBy: actor._id }, { ...first, _id: "other-month", date: "2020-02-01" },
    { ...first, _id: "import", type: "import" }, { ...first, _id: "return", type: "return" },
    { ...first, _id: "adjustment", source: "product_update" }, { ...first, _id: "pending", approvalStatus: "pending" });
  const result = service.summarize(user, month, movements, 1);
  assert.equal(result.revenue, 240246.9);
  assert.equal(result.amount, 2402);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.closed, false);
  assert.equal(service.summarize(user, month, movements, 1.25).amount, 3003);
  assert.equal(service.summarize(user, month, movements, 0).amount, 0);
});
test("tháng theo ngày nghiệp vụ, giữ đúng ranh giới tháng và năm", () => {
  assert.deepEqual(service.monthRange("2020-02"), { $gte: new Date("2020-02-01"), $lt: new Date("2020-03-01") });
  assert.deepEqual(service.monthRange("2020-12"), { $gte: new Date("2020-12-01"), $lt: new Date("2021-01-01") });
  assert.throws(() => service.monthRange("2020-13"));
});
test("đọc tỷ lệ fallback và hỗ trợ phần trăm lẻ, truy vấn giới hạn tháng và nhân viên", async (t) => {
  const { user, config } = fixture(t);
  config.value = undefined;
  assert.equal(await service.getPercent(), 1);
  config.value = 1.25;
  const [result] = await service.monthly([user], month);
  assert.equal(result.commission.percent, 1.25);
  const filter = Movement.find.mock.calls[0].arguments[0];
  assert.deepEqual(filter.createdBy.$in, [user._id]);
  assert.deepEqual(filter.date, service.monthRange(month));
  assert.equal(filter.type, "export");
});
test("admin chốt snapshot cố định, không thay đổi lương cũ, không cho chốt trùng", async (t) => {
  const { user, movements, config } = fixture(t);
  const oldPayroll = JSON.stringify(user.payroll);
  const preview = service.summarize(user, month, movements, config.value);
  const snapshot = await service.close(user._id, { month, reviewVersion: preview.reviewVersion }, actor);
  assert.equal(snapshot.revenue, 150246.9);
  assert.equal(snapshot.percent, 1);
  assert.equal(snapshot.amount, 1502);
  assert.equal(String(snapshot.closedBy), String(actor._id));
  assert.ok(snapshot.closedAt instanceof Date);
  assert.equal(JSON.stringify(user.payroll), oldPayroll);
  movements[0].items[0].amount = 999;
  config.value = 5;
  const frozen = service.summarize(user, month, movements, config.value);
  assert.equal(frozen.revenue, snapshot.revenue);
  assert.equal(frozen.percent, 1);
  assert.equal(frozen.amount, 1502);
  assert.equal(frozen.closed, true);
  await assert.rejects(service.close(user._id, { month, reviewVersion: preview.reviewVersion }, actor), /đã được chốt/);
  assert.equal(User.updateOne.mock.callCount(), 1);
});
test("chặn chốt khi phiếu hoặc tỷ lệ thay đổi sau lúc admin mở trang", async (t) => {
  const { user, movements, config } = fixture(t);
  const preview = service.summarize(user, month, movements, 1);
  const body = { month, reviewVersion: preview.reviewVersion };
  config.value = 2;
  await assert.rejects(service.close(user._id, body, actor), /đã thay đổi/);
  config.value = 1;
  movements[0].items[0].amount = 3;
  await assert.rejects(service.close(user._id, body, actor), /đã thay đổi/);
  assert.equal(User.updateOne.mock.callCount(), 0);
});
test("chặn chốt khi còn phiếu chờ duyệt hoặc thiếu doanh thu", async (t) => {
  const { user, movements } = fixture(t);
  movements[0].approvalStatus = "pending";
  await assert.rejects(service.close(user._id, { month }, actor), /chờ duyệt/);
  movements[0].approvalStatus = "approved";
  movements[0].items[0].saleSnapshot = null;
  await assert.rejects(service.close(user._id, { month }, actor), /thiếu doanh thu/);
  assert.equal(User.updateOne.mock.callCount(), 0);
});
test("chỉ admin chốt cho staff, kiểm tra tháng hợp lệ và ngăn chốt tương lai", async (t) => {
  const { user } = fixture(t);
  await assert.rejects(service.close(user._id, { month }, { role: "staff" }), /quản trị viên/);
  await assert.rejects(service.close(user._id, { month: "2020-13" }, actor), /YYYY-MM/);
  await assert.rejects(service.close(user._id, { month: "9999-01" }, actor), /tương lai/);
  user.role = "admin";
  await assert.rejects(service.close(user._id, { month }, actor), /Chỉ chốt hoa hồng cho nhân viên/);
  assert.equal(User.updateOne.mock.callCount(), 0);
});
test("chốt tháng không doanh thu bằng 0 và xử lý xung đột ghi không tạo bản trùng", async (t) => {
  const { user, movements } = fixture(t);
  movements.length = 0;
  const body = { month, reviewVersion: service.summarize(user, month, movements, 1).reviewVersion };
  t.mock.method(User, "updateOne", async () => ({ modifiedCount: 0 }));
  await assert.rejects(service.close(user._id, body, actor), /đã được chốt hoặc tài khoản đã thay đổi/);
  t.mock.method(User, "updateOne", async (_filter, update) => {
    assert.equal(update.$push.commissions.amount, 0);
    return { modifiedCount: 1 };
  });
  assert.equal((await service.close(user._id, body, actor)).amount, 0);
});
test("cấu hình nhận phần trăm lẻ, từ chối vượt 100 và không còn sửa đơn giá cũ", async (t) => {
  const controller = require("../controllers/configurationController");
  t.mock.method(Configuration, "updateOne", async () => ({}));
  const req = { params: { platform: "system", key: "commissionPercent" }, body: { value: "1.25" } };
  await controller.update(req, { redirect() {} });
  assert.equal(Configuration.updateOne.mock.calls[0].arguments[1].$set.value, 1.25);
  for (const value of ["", "abc", "-1", "100.01"]) {
    req.body.value = value;
    await assert.rejects(controller.update(req, { redirect() {} }));
  }
  req.params.key = "ratePerOrder";
  await assert.rejects(controller.update(req, { redirect() {} }), /không hợp lệ/);
});
test("giao diện ẩn chấm công/số đơn, chỉ admin có nút chốt và staff chỉ xem hoa hồng của mình", async (t) => {
  const { user, movements } = fixture(t);
  const commission = service.summarize(user, month, movements, 1);
  const locals = { item: user, month, commission, own: false, money: String, dateTime: String,
    csrfToken: "test", dateInput: () => "2020-01-31" };
  const file = path.join(__dirname, "../views/pages/users/detail.ejs");
  const admin = await ejs.renderFile(file, locals);
  assert.match(admin, /Chốt hoa hồng tháng 2020-01/);
  assert.match(admin, /name="reviewVersion"/);
  assert.ok(!admin.includes("Chấm công"));
  assert.ok(!admin.includes("Số đơn"));
  const staff = await ejs.renderFile(file, { ...locals, own: true });
  assert.ok(!staff.includes("/commission/close"));
  const index = await ejs.renderFile(path.join(__dirname, "../views/pages/users/index.ejs"), {
    ...locals, items: [{ ...user, commission }], page: 1, total: 1, limit: 20
  });
  assert.match(index, /Xem và chốt/);
  assert.ok(!index.includes("Tổng đơn"));
  assert.ok(!index.includes("timekeeping"));
  for (const role of ["admin", "staff"]) {
    const layout = await ejs.renderFile(path.join(__dirname, "../views/layouts/main.ejs"), {
      ...locals, currentUser: { username: "staff", role }, title: "Hoa hồng", message: "", error: "", body: ""
    });
    assert.ok(!layout.includes("timekeeping"));
    if (role === "staff") assert.match(layout, /Hoa hồng của tôi/);
  }
  const closed = { month, revenue: 150246.9, percent: 1, amount: 1502,
    closedBy: { username: "<script>bad</script>" }, closedAt: new Date() };
  const history = await ejs.renderFile(file, { ...locals, item: { ...user, commissions: [closed] },
    commission: { ...closed, closed: true } });
  assert.match(history, /Đã chốt/);
  assert.ok(!history.includes("/commission/close"));
  assert.ok(!history.includes("<script>bad</script>"));
  const controller = require("../controllers/userController");
  let owner;
  t.mock.method(User, "findById", (id) => { owner = id; return query(user); });
  await controller.ownCommission({ user: { _id: user._id }, params: { id: "other" }, query: { month } }, { render() {} });
  assert.equal(owner, user._id);
  const router = require("../routes/userRoutes");
  const request = (url, role, method = "GET") => new Promise((resolve, reject) => {
    router.handle({ url, method, query: { month }, body: {}, user: role ? { _id: user._id, role } : null },
      { redirect: (location) => resolve({ location }), render: (view, data) => resolve({ view, data }) },
      (error) => reject(error || new Error("Không tìm thấy route")));
  });
  assert.equal((await request("/commission")).location, "/auth/login");
  assert.equal((await request("/commission", "staff")).data.own, true);
  assert.match((await request("/other/commission/close", "staff", "POST")).location, /^\/dashboard\?error=/);
  assert.match((await request("/other", "staff")).location, /^\/dashboard\?error=/);
});
