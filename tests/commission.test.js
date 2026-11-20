const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ejs = require("ejs");
const User = require("../models/User");
const Configuration = require("../models/Configuration");
const Movement = require("../models/ImportAndExport");
const { keys } = require("../utils/configuration");
const render = (file, locals) => ejs.renderFile(path.join(__dirname, "../views", file), {
  csrfToken: "test", money: String, dateTime: String, ...locals
});

test("mọi vai trò không thể xem hoặc chốt hoa hồng qua URL cũ", async (t) => {
  const router = require("../routes/userRoutes");
  t.mock.method(User, "findById", () => assert.fail("Không được truy vấn tài khoản"));
  t.mock.method(User, "updateOne", () => assert.fail("Không được ghi hoa hồng"));
  for (const role of ["admin", "staff"]) {
    for (const [url, method] of [["/commission", "GET"], ["/example/commission/close", "POST"]]) {
      const status = await new Promise((resolve, reject) => router.handle({ url, method, user: { role } },
        { sendStatus: resolve }, error => reject(error || new Error("Không xử lý URL cũ"))));
      assert.equal(status, 404);
    }
  }
});

test("giao diện không hiển thị hoa hồng kể cả khi có dữ liệu lịch sử", async () => {
  const item = { _id: "example", username: "staff", role: "staff", active: true, payroll: [],
    commissions: [{ month: "2020-01", revenue: 999999, percent: 1, amount: 9999 }] };
  const html = [
    await render("pages/users/index.ejs", { items: [item], page: 1, total: 1, limit: 20 }),
    await render("pages/users/detail.ejs", { item }),
    await render("pages/configuration/index.ejs", { rows: [{ platform: "system", key: "commissionPercent", value: 1 }], keys })
  ];
  for (const role of ["admin", "staff"]) html.push(await render("layouts/main.ejs", {
    currentUser: { username: role, role }, title: "Tổng quan", message: "", error: "", body: ""
  }));
  for (const page of html) assert.doesNotMatch(page, /Hoa hồng|hoa hồng|commission|999999|Xem và chốt/);
  assert.match(html[0], /Chỉnh sửa/);
  assert.match(html[2], /Shopee/);
});

test("cấu hình hoa hồng cũ không ghi được, cấu hình phí sàn vẫn hỗ trợ phần trăm lẻ", async (t) => {
  const controller = require("../controllers/configurationController");
  const write = t.mock.method(Configuration, "updateOne", async () => ({}));
  await assert.rejects(controller.update({ params: { platform: "system", key: "commissionPercent" }, body: { value: 1 } }, {}), /không hợp lệ/);
  assert.equal(write.mock.callCount(), 0);
  await controller.update({ params: { platform: "shopee", key: "tax" }, body: { value: "1.25" } }, { redirect() {} });
  assert.equal(write.mock.calls[0].arguments[1].$set.value, 1.25);
});

test("danh sách nhân viên không tính hoa hồng hoặc đọc doanh thu kho", async (t) => {
  const controller = require("../controllers/userController");
  t.mock.method(User, "countDocuments", async () => 1);
  t.mock.method(User, "find", () => ({ sort() { return this; }, skip() { return this; }, limit() { return this; },
    lean: async () => [{ _id: "example", username: "staff", role: "staff", active: true }] }));
  t.mock.method(Movement, "find", () => assert.fail("Không được đọc doanh thu để tính hoa hồng"));
  t.mock.method(Configuration, "findOne", () => assert.fail("Không được đọc tỷ lệ hoa hồng"));
  let data;
  await controller.index({ query: {} }, { render: (_, value) => { data = value; } });
  assert.equal(data.items.length, 1);
  assert.equal(data.commission, undefined);
});

test("seed không tạo lại cấu hình hoa hồng", async (t) => {
  const seed = require("../scripts/seed");
  const previousUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = "admin-test";
  t.after(() => {
    if (previousUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = previousUsername;
  });
  t.mock.method(User, "findOne", async () => ({ role: "admin" }));
  const write = t.mock.method(Configuration, "updateOne", async () => ({}));
  t.mock.method(Configuration, "updateMany", async () => ({}));
  t.mock.method(require("../models/InventoryApproval"), "init", async () => {});
  t.mock.method(require("../models/MonthlyAdsClosing"), "init", () => assert.fail("Không khởi tạo tính năng Ads tháng"));
  t.mock.method(console, "log", () => {});
  await seed();
  assert.equal(write.mock.calls.filter(call => call.arguments[2]?.upsert).length, 10);
  for (const call of write.mock.calls) assert.equal(call.arguments[0].platform, "shopee");
});
