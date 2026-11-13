const test = require("node:test");
const assert = require("node:assert/strict");
const Product = require("../models/Product");
const { prepareProducts, migrate, main } = require("../scripts/migrate-dreammoon");

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

test("nguồn có đủ 12 SKU Dreammoon, 64 lọ và chỉ định giá Shopee", () => {
  const products = prepareProducts();
  assert.equal(products.length, 12);
  assert.equal(new Set(products.map((p) => p.sku)).size, 12);
  assert.equal(products.reduce((sum, p) => sum + p.quantity, 0), 64);
  assert.deepEqual(products.map(({ name, sku, quantity }) => [name, sku, quantity]), [
    ["Pink Summer", "DREAMMOON_PINK_SUMMER", 2],
    ["Choco Nature", "DREAMMOON_CHOCO_NATURE", 10],
    ["Black Kelly", "DREAMMOON_BLACK_KELLY", 2],
    ["Black Pastel", "DREAMMOON_BLACK_PASTEL", 6],
    ["Gray Tiana", "DREAMMOON_GRAY_TIANA", 6],
    ["Gray Helena", "DREAMMOON_GRAY_HELENA", 6],
    ["Choco Kimchi", "DREAMMOON_CHOCO_KIMCHI", 8],
    ["Choco Opera", "DREAMMOON_CHOCO_OPERA", 6],
    ["Black Mario", "DREAMMOON_BLACK_MARIO", 4],
    ["Gray Greenery", "DREAMMOON_GRAY_GREENERY", 4],
    ["Gray Louis", "DREAMMOON_GRAY_LOUIS", 4],
    ["Choco Bella", "DREAMMOON_CHOCO_BELLA", 6]
  ]);
  assert.deepEqual(products[0], {
    sku: "DREAMMOON_PINK_SUMMER", name: "Pink Summer", quantity: 2,
    purchasePrice: 25000, shopeePrice: 73000, tiktokPrice: null,
    ads: { shopee: { enabled: true, percentOverride: null },
      tiktok: { enabled: false, percentOverride: null } }, note: ""
  });
  for (const product of products) {
    assert.equal(product.purchasePrice, 25000);
    assert.equal(product.shopeePrice, 73000);
    assert.equal(product.tiktokPrice, null);
    assert.equal(product.ads.shopee.enabled, true);
    assert.equal(new Product(product).validateSync(), undefined);
  }
});

test("xem trước mặc định không tạo index hoặc ghi database", async () => {
  const db = database([{ sku: "DREAMMOON_PINK_SUMMER", quantity: 99 }]);
  const summary = await migrate({ model: db.model });
  assert.equal(summary.mode, "preview");
  assert.equal(summary.pending, 11);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.created, 0);
  assert.equal(db.calls.init, 0);
  assert.equal(db.calls.updates.length, 0);
  assert.equal(db.documents.size, 1);
});

test("apply tạo SKU thiếu, chạy lại không đổi giá hoặc tồn đã phát sinh", async () => {
  const existing = { sku: "DREAMMOON_PINK_SUMMER", name: "Tên đã sửa", quantity: 99,
    purchasePrice: 29000, shopeePrice: 80000, tiktokPrice: 90000, updatedAt: new Date(0) };
  const db = database([existing]);
  const first = await migrate({ apply: true, model: db.model });
  assert.equal(first.created, 11);
  assert.equal(first.skipped, 1);
  assert.equal(db.documents.size, 12);
  assert.deepEqual(db.documents.get(existing.sku), existing);
  const sold = db.documents.get("DREAMMOON_CHOCO_NATURE");
  sold.quantity = 0;
  sold.shopeePrice = 75000;
  const before = structuredClone([...db.documents]);
  const second = await migrate({ apply: true, model: db.model });
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 12);
  assert.equal(db.calls.updates.length, 11);
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

test("lỗi giữa chừng có thể chạy lại mà không cộng lại tồn của SKU đã nhập", async () => {
  const db = database();
  const updateOne = db.model.updateOne;
  let writes = 0;
  db.model.updateOne = async (...args) => {
    if (++writes === 4) throw new Error("Mất kết nối");
    return updateOne(...args);
  };
  await assert.rejects(migrate({ apply: true, model: db.model }), /Mất kết nối/);
  assert.equal(db.documents.size, 3);
  db.documents.get("DREAMMOON_CHOCO_NATURE").quantity = 1;
  db.model.updateOne = updateOne;
  const result = await migrate({ apply: true, model: db.model });
  assert.equal(result.created, 9);
  assert.equal(result.skipped, 3);
  assert.equal(db.documents.size, 12);
  assert.equal(db.documents.get("DREAMMOON_CHOCO_NATURE").quantity, 1);
});
