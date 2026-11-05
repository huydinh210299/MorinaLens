const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Movement = require("../models/ImportAndExport");
const User = require("../models/User");
const Configuration = require("../models/Configuration");
const inventory = require("../services/inventoryService");
const pricing = require("../services/pricingService");
const { summarizeMovements } = require("../services/revenueService");
const { keys } = require("../utils/configuration");

const defaults = Object.fromEntries(Object.entries(keys).map(([key, meta]) => [key, meta.defaultValue]));
const body = (platform = "shopee", items = [{ sku: "LENS-01", amount: 2 }]) => ({
  type: "export", date: "2026-11-03", platform, items
});
const query = (value) => ({
  session() { return this; }, select() { return this; },
  lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
});

function setup(t) {
  const config = { ...defaults };
  const product = new Product({ sku: "LENS-01", name: "Lens", quantity: 20, purchasePrice: 10000,
    shopeePrice: 50000, tiktokPrice: 60000,
    ads: { shopee: { enabled: true, percentOverride: 8 }, tiktok: { enabled: false } } });
  const secondProduct = new Product({ ...product.toObject(), _id: new mongoose.Types.ObjectId(), sku: "LENS-02" });
  const actor = { _id: new mongoose.Types.ObjectId(), role: "admin" };
  const originalDb = mongoose.connection.db;
  mongoose.connection.db = { admin: () => ({ command: async () => ({}) }) };
  t.after(() => { mongoose.connection.db = originalDb; });
  const state = { movement: null, config, product, secondProduct, actor, stockWrites: 0 };
  t.mock.method(pricing, "getConfig", async () => state.config);
  t.mock.method(Product, "findOne", ({ sku }) => query(sku === "LENS-01" ? product : secondProduct));
  t.mock.method(Product, "findOneAndUpdate", async ({ sku }) => {
    state.stockWrites += 1;
    return sku === "LENS-02" ? secondProduct : product;
  });
  t.mock.method(Movement, "create", async ([data]) => {
    state.movement = new Movement(data);
    assert.ifError(state.movement.validateSync());
  });
  t.mock.method(Movement, "findById", () => query(state.movement));
  t.mock.method(Movement.prototype, "save", async function () {
    assert.ifError(this.validateSync());
    return this;
  });
  t.mock.method(User, "findById", () => query({ orders: [] }));
  t.mock.method(Configuration, "findOne", () => query(null));
  return state;
}

test("phiếu xuất lưu đủ đầu vào và tính lại độc lập với cấu hình hiện tại", async (t) => {
  const state = setup(t);
  // Cấu hình do client gửi phải bị bỏ qua.
  await inventory.create({ ...body(), config: { tax: 100 }, items: [{ sku: "LENS-01", amount: 2,
    saleSnapshot: { config: { tax: 100 }, purchasePrice: 0 } }] }, state.actor);
  const snapshot = state.movement.items[0].saleSnapshot.toObject();
  assert.deepEqual(snapshot.config, defaults);
  assert.equal(snapshot.purchasePrice, 10000);
  assert.equal(snapshot.adsPercentApplied, 8);
  assert.equal(snapshot.pricingVersion, 2);
  assert.ok(snapshot.unitAdsCost > 0);
  assert.equal(state.movement.toObject().config, undefined);
  assert.equal(snapshot.tax, undefined);

  state.config.tax = 10;
  state.config.packaging = 100000;
  state.product.purchasePrice = 40000;
  state.product.shopeePrice = 90000;
  state.product.ads.shopee.percentOverride = 30;
  const saved = state.movement.items[0].saleSnapshot;
  const recalculated = pricing.calculate(saved.listPrice, saved.purchasePrice, saved.config, saved.adsPercentApplied, saved.pricingVersion);
  assert.equal(recalculated.sale, snapshot.unitRevenue);
  assert.equal(recalculated.cost, snapshot.unitCost);
  assert.equal(recalculated.profit, snapshot.unitProfit);
  const report = summarizeMovements([state.movement.toObject()]);
  assert.equal(report.totals.revenue, recalculated.sale * 2);
  assert.equal(report.totals.profit, recalculated.profit * 2);
  assert.equal(report.totals.adsCost, snapshot.unitAdsCost * 2);
});

test("sửa số lượng giữ snapshot dù cấu hình hiện tại không còn đầy đủ", async (t) => {
  const state = setup(t);
  await inventory.create(body(), state.actor);
  const snapshot = state.movement.items[0].saleSnapshot.toObject();
  state.config = null;
  state.product.purchasePrice = 40000;
  await inventory.update(state.movement._id, body("shopee", [{ sku: "LENS-01", amount: 3 }]));
  assert.deepEqual(state.movement.items[0].saleSnapshot.toObject(), snapshot);
  assert.equal(pricing.getConfig.mock.callCount(), 1);
  const report = summarizeMovements([state.movement.toObject()]);
  assert.equal(report.totals.profit, snapshot.unitProfit * 3);
});

test("đổi sàn chụp cấu hình, giá và Ads của sàn mới", async (t) => {
  const state = setup(t);
  await inventory.create(body(), state.actor);
  state.config = { ...defaults, transactionFee: 9, packaging: 5000 };
  state.product.purchasePrice = 12000;
  await inventory.update(state.movement._id, body("tiktok"));
  const snapshot = state.movement.items[0].saleSnapshot;
  assert.equal(snapshot.listPrice, 60000);
  assert.equal(snapshot.purchasePrice, 12000);
  assert.equal(snapshot.adsPercentApplied, 0);
  assert.deepEqual(snapshot.config.toObject(), state.config);
  assert.equal(pricing.getConfig.mock.calls.at(-1).arguments[0], "tiktok");
});

test("thêm SKU chỉ chụp cấu hình mới cho dòng mới", async (t) => {
  const state = setup(t);
  await inventory.create(body(), state.actor);
  const snapshot = state.movement.items[0].saleSnapshot.toObject();
  state.config = { ...defaults, ads: 22, packaging: 6000 };
  state.secondProduct.ads.shopee.percentOverride = null;
  await inventory.update(state.movement._id, body("shopee", [
    { sku: "LENS-01", amount: 2 }, { sku: "LENS-02", amount: 1 }
  ]));
  assert.deepEqual(state.movement.items[0].saleSnapshot.toObject(), snapshot);
  assert.deepEqual(state.movement.items[1].saleSnapshot.config.toObject(), state.config);
  assert.equal(state.movement.items[1].saleSnapshot.adsPercentApplied, 22);
});

test("phiếu cũ giữ kết quả lịch sử và không bị gán cấu hình mới", async (t) => {
  const state = setup(t);
  await inventory.create(body(), state.actor);
  const old = state.movement.toObject();
  delete old.items[0].saleSnapshot.config;
  delete old.items[0].saleSnapshot.purchasePrice;
  state.movement = new Movement(old);
  state.config = null;
  await inventory.update(state.movement._id, body("shopee", [{ sku: "LENS-01", amount: 4 }]));
  assert.equal(state.movement.items[0].saleSnapshot.config, null);
  assert.equal(state.movement.items[0].saleSnapshot.purchasePrice, null);
  assert.equal(state.movement.items[0].saleSnapshot.unitProfit, old.items[0].saleSnapshot.unitProfit);
});

test("thiếu cấu hình chặn xuất trước khi thay đổi tồn kho", async (t) => {
  const state = setup(t);
  delete state.config.tax;
  await assert.rejects(inventory.create(body("tiktok"), state.actor), /Chưa đủ cấu hình/);
  assert.equal(state.stockWrites, 0);
  assert.equal(state.movement, null);
});

test("phiếu nhập và hoàn không chụp cấu hình bán hàng", async (t) => {
  const state = setup(t);
  for (const type of ["import", "return"]) {
    await inventory.create({ ...body(), type }, state.actor);
    assert.equal(state.movement.items[0].saleSnapshot, null);
  }
  assert.equal(pricing.getConfig.mock.callCount(), 0);
});

test("snapshot mới lưu voucher tiền lớn hơn 100đ và tiền Ads theo thực nhận", async (t) => {
  const state = setup(t);
  state.config.shopVoucher = 2000;
  state.product.shopeePrice = 72966;
  state.product.ads.shopee.percentOverride = 15;
  await inventory.create(body(), state.actor);
  const saved = state.movement.items[0].saleSnapshot;
  assert.equal(saved.config.shopVoucher, 2000);
  assert.equal(saved.unitRevenue, 70966);
  assert.ok(Math.abs(saved.unitAdsCost - 7054.65) < 1e-8);
  assert.ifError(state.movement.validateSync());
});
