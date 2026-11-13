const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/User");
const Product = require("../models/Product");
const Movement = require("../models/ImportAndExport");
const Configuration = require("../models/Configuration");
const inventory = require("../services/inventoryService");
const pricing = require("../services/pricingService");
const { keys } = require("../utils/configuration");

const query = (value) => ({
  session() { return this; }, select() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
});
function setup(t) {
  const product = new Product({ sku: "LENS-01", name: "Lens", quantity: 20, purchasePrice: 10000, shopeePrice: 50000 });
  const user = new User({ username: "staff", password: "hash", orders: [
    { date: "2026-11-01", amount: 1, movement: new mongoose.Types.ObjectId() },
    { date: "2026-11-02", amount: 30, attendance: true, approved: true }
  ], payroll: [{ month: "2026-11", orderCount: 31, ratePerOrder: 1500, amount: 46500 }] });
  const originalUser = user.toObject();
  const originalDb = mongoose.connection.db;
  mongoose.connection.db = { admin: () => ({ command: async () => ({}) }) };
  t.after(() => {
    mongoose.connection.db = originalDb;
    assert.deepEqual(user.toObject(), originalUser);
    assert.equal(User.findById.mock.callCount(), 0);
    assert.equal(Configuration.findOne.mock.callCount(), 0);
  });
  t.mock.method(User, "findById", () => { throw new Error("Phiếu kho không được truy cập công hoặc lương nhân viên"); });
  t.mock.method(Configuration, "findOne", () => { throw new Error("Phiếu kho không được đọc đơn giá công"); });
  t.mock.method(pricing, "getConfig", async () => Object.fromEntries(Object.entries(keys).map(([key, meta]) => [key, meta.defaultValue])));
  t.mock.method(Product, "findOne", () => query(product));
  t.mock.method(Product, "findOneAndUpdate", async (_filter, update) => {
    product.quantity += update.$inc.quantity;
    return product;
  });
  const state = { product, user, movement: null, saves: 0, deleted: false };
  t.mock.method(Movement, "create", async ([data]) => {
    state.movement = new Movement(data);
    assert.ifError(state.movement.validateSync());
  });
  t.mock.method(Movement, "findById", () => query(state.movement));
  t.mock.method(Movement.prototype, "save", async function () {
    assert.ifError(this.validateSync());
    state.saves++;
    return this;
  });
  t.mock.method(Movement.prototype, "deleteOne", async () => { state.deleted = true; });
  return state;
}
const body = (type, amount = 2, date = "2026-11-03") => ({ type, date, platform: "shopee", items: [{ sku: "LENS-01", amount }] });
const adminId = new mongoose.Types.ObjectId();

for (const [role, types] of [["admin", ["export", "return", "import"]], ["staff", ["export", "return"]]]) {
  for (const type of types) {
    test(`phiếu ${type} do ${role} tạo chờ duyệt, sửa phiếu đã duyệt yêu cầu duyệt lại, không cộng công`, async (t) => {
      const state = setup(t);
      const actor = { _id: state.user._id, role };
      const sign = type === "export" ? -1 : 1;
      await inventory.create(body(type), actor);
      assert.equal(state.product.quantity, 20 + sign * 2);
      assert.equal(state.movement.requiresApproval, true);
      assert.equal(state.movement.approvalStatus, "pending");
      assert.equal(state.movement.approvedBy, null);
      assert.equal(state.movement.approvedAt, null);
      state.movement.approvalStatus = "approved";
      state.movement.approvedBy = adminId;
      state.movement.approvedAt = new Date();
      state.movement.approvalBatch = "old-batch";
      await inventory.update(state.movement._id, body(type, 3, "2026-12-02"));
      assert.equal(state.product.quantity, 20 + sign * 3);
      assert.equal(state.movement.approvalStatus, "pending");
      assert.equal(state.movement.approvedBy, null);
      assert.equal(state.movement.approvedAt, null);
      assert.equal(state.movement.approvalBatch, null);
      await inventory.remove(state.movement._id);
      assert.equal(state.product.quantity, 20);
      assert.equal(state.deleted, true);
    });
  }
}

test("điều chỉnh tồn từ sản phẩm cũng tạo phiếu chờ duyệt", async (t) => {
  const state = setup(t);
  t.mock.method(Product, "findById", () => query(state.product));
  t.mock.method(state.product, "save", async () => state.product);
  await require("../services/productService").update(state.product._id, {
    sku: "LENS-01", name: "Lens", purchasePrice: 10000, quantity: 25, expectedQuantity: 20,
    shopeePrice: 50000, tiktokPrice: ""
  }, { _id: adminId, role: "admin" });
  assert.equal(state.product.quantity, 25);
  assert.equal(state.movement.source, "product_update");
  assert.equal(state.movement.approvalStatus, "pending");
  assert.equal(state.movement.requiresApproval, true);
  assert.equal(state.movement.approvedBy, null);
});
