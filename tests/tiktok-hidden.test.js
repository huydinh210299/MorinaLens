const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ejs = require("ejs");
const Product = require("../models/Product");
const Movement = require("../models/ImportAndExport");
const Configuration = require("../models/Configuration");
const pricing = require("../services/pricingService");
const inventory = require("../services/inventoryService");
const approval = require("../services/inventoryApprovalService");
const { keys } = require("../utils/configuration");
const { paginateRows } = require("../utils/pagination");
const config = Object.fromEntries(Object.entries(keys).map(([key, meta]) => [key, meta.defaultValue]));

test("các trang chính chỉ hiển thị Shopee cho mọi vai trò", async () => {
  const item = new Product({ sku: "LENS", name: "Lens", quantity: 2, purchasePrice: 25000,
    shopeePrice: 75000, tiktokPrice: 99999, ads: { tiktok: { enabled: true, percentOverride: 12 } } }).toObject();
  item.pricing = { shopee: pricing.calculateProduct(item, config, "shopee") };
  const report = require("../services/revenueService").summarizeMovements([]);
  const helpers = { title: "Test", money: String, preciseMoney: String, dateTime: String, dateInput: () => "2020-01-01",
    csrfToken: "csrf", products: 1, outOfStock: 0, pending: 0, staff: 1,
    item, source: item, items: [item], page: 1, total: 1, limit: 20, q: "", shopee: config, configKeys: keys,
    hasCompleteConfig: pricing.hasCompleteConfig, adsDefaults: { shopee: 15 }, keys, rows: [],
    month: "2020-01", report: { ...report, pendingCount: 0 }, dailyPage: paginateRows([]),
    example: { price: 72966, purchasePrice: 25000, config, result: pricing.calculate(72966, 25000, config) } };
  for (const role of ["admin", "staff"]) {
    for (const file of ["products/index", "products/form", "products/clone", "configuration/index", "dashboard/index", "guide/index", "revenue/index"]) {
      const html = await ejs.renderFile(path.join(__dirname, `../views/pages/${file}.ejs`), { ...helpers, currentUser: { role } });
      assert.doesNotMatch(html, /tiktok|99999/i, `${file}: không hiển thị TikTok`);
    }
    const html = await ejs.renderFile(path.join(__dirname, "../views/pages/inventory/form.ejs"), {
      ...helpers, currentUser: { role }, item: null, products: []
    });
    assert.doesNotMatch(html, /tiktok/i);
    assert.match(html, /name="platform" value="shopee"/);
  }
});

test("sửa sản phẩm từ form Shopee giữ nguyên giá và Ads TikTok cũ", async (t) => {
  t.mock.method(inventory, "runInventory", async work => work(null));
  const service = require("../services/productService");
  const product = new Product({ sku: "LENS", name: "Lens", quantity: 2, purchasePrice: 25000,
    shopeePrice: 75000, tiktokPrice: 99000, ads: { tiktok: { enabled: true, percentOverride: 12 } } });
  const previousAds = product.ads.tiktok.toObject();
  t.mock.method(Product, "findById", () => ({ session: async () => product }));
  t.mock.method(product, "save", async () => product);
  await service.update(product._id, { sku: "LENS", name: "Tên mới", purchasePrice: 26000, shopeePrice: 80000,
    ads: { shopee: { enabled: "on", percentOverride: "5" } } }, { _id: "admin" });
  assert.equal(product.name, "Tên mới");
  assert.equal(product.shopeePrice, 80000);
  assert.equal(product.tiktokPrice, 99000);
  assert.deepEqual(product.ads.tiktok.toObject(), previousAds);
});

test("kho và duyệt phiếu luôn giới hạn Shopee kể cả khi URL hoặc form cũ chọn TikTok", async (t) => {
  const controller = require("../controllers/inventoryController");
  const read = t.mock.method(approval, "getReview", async query => { assert.equal(query.platform, "shopee"); return {}; });
  const approve = t.mock.method(approval, "approve", async body => {
    assert.equal(body.platform, "shopee"); return { platform: "shopee", approvedCount: 0 };
  });
  await controller.index({ query: { platform: "tiktok" } }, { render() {} });
  await controller.approve({ body: { platform: "tiktok" }, user: { role: "admin" } }, { redirect() {} });
  assert.equal(read.mock.callCount(), 1);
  assert.equal(approve.mock.callCount(), 1);
  t.mock.method(inventory, "create", () => assert.fail("Không tạo phiếu sàn đang ẩn"));
  await assert.rejects(controller.create({ body: { platform: "tiktok" } }, {}), /không khả dụng/);
  t.mock.method(Movement, "findById", () => ({ lean: async () => ({ platform: "tiktok" }) }));
  await assert.rejects(controller.form({ params: { id: "old" } }, {}), /Không tìm thấy/);
  await assert.rejects(controller.update({ params: { id: "old" }, body: { platform: "shopee" } }, {}), /Không tìm thấy/);
  await assert.rejects(controller.remove({ params: { id: "old" } }, {}), /Không tìm thấy/);
});

test("báo cáo hiển thị chỉ truy vấn doanh thu và phiếu chờ Shopee", async (t) => {
  const controller = require("../controllers/revenueController");
  const find = t.mock.method(Movement, "find", filter => {
    assert.equal(filter.platform, "shopee"); return { lean: async () => [] };
  });
  t.mock.method(Movement, "countDocuments", async filter => { assert.equal(filter.platform, "shopee"); return 0; });
  await controller.index({ query: { month: "2020-01" } }, { render() {} });
  assert.equal(find.mock.callCount(), 1);
});

test("không sửa được cấu hình sàn đang ẩn", async (t) => {
  const controller = require("../controllers/configurationController");
  t.mock.method(Configuration, "updateOne", () => assert.fail("Không ghi cấu hình TikTok"));
  await assert.rejects(controller.update({ params: { platform: "tiktok", key: "tax" }, body: { value: 1 } }, {}), /không hợp lệ/);
});
