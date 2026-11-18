const test = require("node:test");
const assert = require("node:assert/strict");
const Product = require("../models/Product");
const { prepareProducts, importProducts } = require("../scripts/migrations/import-lens-accessories");
const { main } = require("../scripts/migrate-lens-accessories");

function database(initial = []) {
  const documents = new Map(initial.map((p) => [p.sku, structuredClone(p)]));
  const calls = { indexes: 0, updates: 0 };
  const model = {
    async createIndexes() { calls.indexes += 1; },
    find(query) {
      return { select: () => ({ lean: async () => [...documents.values()]
        .filter((p) => query.sku.$in.includes(p.sku)).map(({ sku }) => ({ sku })) }) };
    },
    async updateOne(filter, update, options) {
      calls.updates += 1;
      assert.deepEqual(Object.keys(update), ["$setOnInsert"]);
      assert.equal(options.timestamps, false);
      assert.equal(options.upsert, true);
      if (documents.has(filter.sku)) return { upsertedCount: 0 };
      documents.set(filter.sku, structuredClone(update.$setOnInsert));
      return { upsertedCount: 1 };
    }
  };
  return { model, documents, calls };
}

test("4 sản phẩm phụ trợ đúng tồn và giá, tắt Ads cả hai sàn", () => {
  const products = prepareProducts();
  assert.deepEqual(products.map(({ sku, name, quantity, purchasePrice, shopeePrice }) =>
    [sku, name, quantity, purchasePrice, shopeePrice]), [
    ["DUNG_CU_HO_TRO_DEO_LENS", "Dụng cụ hỗ trợ đeo lens", 9, 5500, 25000],
    ["NUOC_NGAM", "Nước ngâm", 62, 23000, 62000],
    ["NHO_MAT", "Nhỏ mắt", 65, 24000, 65000],
    ["KHAY_DUNG_LENS", "Khay đựng lens", 83, 3200, 15000]
  ]);
  for (const product of products) {
    assert.equal(product.tiktokPrice, null);
    assert.deepEqual(product.ads, {
      shopee: { enabled: false, percentOverride: null },
      tiktok: { enabled: false, percentOverride: null }
    });
    assert.equal(new Product(product).validateSync(), undefined);
  }
});

test("preview không tạo index hoặc ghi sản phẩm", async () => {
  const db = database([{ sku: "NUOC_NGAM", quantity: 1 }]);
  const result = await importProducts({ model: db.model });
  assert.equal(result.totalQuantity, 219);
  assert.equal(result.pending, 3);
  assert.equal(result.skipped, 1);
  assert.deepEqual(db.calls, { indexes: 0, updates: 0 });
});

test("chỉ thêm SKU thiếu, chạy lại giữ tồn, giá và Ads đã thay đổi", async () => {
  const existing = { ...prepareProducts()[0], quantity: 1, shopeePrice: 30000, updatedAt: new Date(0) };
  const db = database([existing]);
  const first = await importProducts({ apply: true, model: db.model });
  assert.equal(first.created, 3);
  assert.equal(first.skipped, 1);
  assert.deepEqual(db.documents.get(existing.sku), existing);
  db.documents.get("NUOC_NGAM").quantity = 0;
  db.documents.get("NUOC_NGAM").ads.shopee.enabled = true;
  const before = structuredClone([...db.documents]);
  const second = await importProducts({ apply: true, model: db.model });
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 4);
  assert.deepEqual([...db.documents], before);
  assert.equal(db.calls.updates, 3);
});

test("nguồn lỗi dừng trước mọi truy cập database", async () => {
  const valid = { sku: "TEST", name: "Test", quantity: 1, purchasePrice: 10, shopeePrice: 20 };
  for (const rows of [[], [valid, { ...valid, sku: "test" }], [{ ...valid, sku: "BAD SKU" }],
    [{ ...valid, quantity: 1.5 }], [{ ...valid, purchasePrice: -1 }], [{ ...valid, shopeePrice: null }]]) {
    const db = database();
    db.model.find = () => assert.fail("Không được đọc database khi nguồn lỗi");
    await assert.rejects(importProducts({ apply: true, rows, model: db.model }));
    assert.deepEqual(db.calls, { indexes: 0, updates: 0 });
  }
});

test("retry sau lỗi giữa chừng không nhập lại tồn đã bán", async () => {
  const db = database();
  const updateOne = db.model.updateOne;
  let writes = 0;
  db.model.updateOne = async (...args) => {
    if (++writes === 3) throw new Error("Mất kết nối");
    return updateOne(...args);
  };
  await assert.rejects(importProducts({ apply: true, model: db.model }), /Mất kết nối/);
  db.documents.get("NUOC_NGAM").quantity = 2;
  db.model.updateOne = updateOne;
  const result = await importProducts({ apply: true, model: db.model });
  assert.equal(result.created, 2);
  assert.equal(result.skipped, 2);
  assert.equal(db.documents.get("NUOC_NGAM").quantity, 2);
});

test("CLI sai tham số không kết nối database", async () => {
  await assert.rejects(main(["--aply"]), /Cách dùng/);
  await assert.rejects(main(["--apply", "--dry-run"]), /Cách dùng/);
});
