const test = require("node:test");
const assert = require("node:assert/strict");
const Product = require("../models/Product");
const { prepareProducts, migrate, main } = require("../scripts/migrate-bear-lens");

function database(initial = []) {
  const documents = new Map(initial.map((p) => [p.sku, structuredClone(p)]));
  const calls = { init: 0, updates: [] };
  const model = {
    async createIndexes() { calls.init += 1; },
    find(query) {
      return { select: () => ({ lean: async () => [...documents.values()]
        .filter((p) => query.sku.$in.includes(p.sku)).map(({ sku }) => ({ sku })) }) };
    },
    async updateOne(filter, update, options) {
      calls.updates.push({ filter, update, options });
      if (documents.has(filter.sku)) return { upsertedCount: 0 };
      documents.set(filter.sku, structuredClone(update.$setOnInsert));
      return { upsertedCount: 1 };
    }
  };
  return { model, documents, calls };
}

test("nguồn có đủ 43 SKU, 71 tồn đầu kỳ và chỉ định giá Shopee", () => {
  const products = prepareProducts();
  assert.equal(products.length, 43);
  assert.equal(new Set(products.map((p) => p.sku)).size, 43);
  assert.equal(products.reduce((sum, p) => sum + p.quantity, 0), 71);
  assert.deepEqual(products[0], {
    sku: "BEAR_AMBER_BROWN", name: "Amber Brown", quantity: 2,
    purchasePrice: 27000, shopeePrice: 70000, tiktokPrice: null,
    ads: { shopee: { enabled: false, percentOverride: null },
      tiktok: { enabled: false, percentOverride: null } }, note: ""
  });
  for (const product of products) {
    assert.equal(product.purchasePrice, 27000);
    assert.equal(product.shopeePrice, 70000);
    assert.equal(product.tiktokPrice, null);
    assert.equal(new Product(product).validateSync(), undefined);
  }
});

test("xem trước mặc định không tạo index hoặc ghi database", async () => {
  const db = database([{ sku: "BEAR_AMBER_BROWN", quantity: 99 }]);
  const summary = await migrate({ model: db.model });
  assert.equal(summary.mode, "preview");
  assert.equal(summary.pending, 42);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.created, 0);
  assert.equal(db.calls.init, 0);
  assert.equal(db.calls.updates.length, 0);
  assert.equal(db.documents.size, 1);
});

test("apply tạo SKU thiếu, chạy lại không đổi giá hoặc tồn đã phát sinh", async () => {
  const existing = { sku: "BEAR_AMBER_BROWN", name: "Tên đã sửa", quantity: 99,
    purchasePrice: 29000, shopeePrice: 80000, tiktokPrice: 90000, updatedAt: new Date(0) };
  const db = database([existing]);
  const first = await migrate({ apply: true, model: db.model });
  assert.equal(first.created, 42);
  assert.equal(first.skipped, 1);
  assert.equal(db.documents.size, 43);
  assert.deepEqual(db.documents.get(existing.sku), existing);
  const sold = db.documents.get("BEAR_RAIN_BROWN");
  sold.quantity = 0;
  sold.shopeePrice = 75000;
  const before = structuredClone([...db.documents]);
  const second = await migrate({ apply: true, model: db.model });
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 43);
  assert.equal(db.calls.updates.length, 42);
  assert.deepEqual([...db.documents], before);
});

test("upsert chỉ đặt dữ liệu khi insert và không tự sửa timestamps", async () => {
  const db = database();
  await migrate({ apply: true, model: db.model, rows: [{ sku: "lens_01", name: "Lens", quantity: 2 }] });
  assert.equal(db.calls.init, 1);
  const { filter, update, options } = db.calls.updates[0];
  assert.deepEqual(filter, { sku: "LENS_01" });
  assert.deepEqual(Object.keys(update), ["$setOnInsert"]);
  assert.equal(options.upsert, true);
  assert.equal(options.timestamps, false);
  assert.equal(options.runValidators, true);
  assert.ok(update.$setOnInsert.createdAt instanceof Date);
});

test("nguồn sai hoặc SKU trùng phải dừng trước khi ghi bất cứ dòng nào", async () => {
  const valid = { sku: "lens_01", name: "Lens", quantity: 2 };
  for (const rows of [[], [valid, { ...valid, sku: "LENS_01" }],
    [valid, { ...valid, sku: "INVALID SKU" }], [valid, { ...valid, name: "" }],
    ...[-1, 1.5, "abc", null].map((quantity) => [valid, { ...valid, sku: "lens_02", quantity }])]) {
    const db = database();
    await assert.rejects(migrate({ apply: true, model: db.model, rows }));
    assert.equal(db.calls.init, 0);
    assert.equal(db.calls.updates.length, 0);
  }
});

test("tham số sai không được kết nối database", async () => {
  await assert.rejects(main(["--aply"]), /Cách dùng/);
  await assert.rejects(main(["--apply", "--dry-run"]), /Cách dùng/);
});
