const test = require("node:test");
const assert = require("node:assert/strict");
const Product = require("../models/Product");
const { prepareProducts } = require("../scripts/migrate-dreammoon");
const { updateQuantities } = require("../scripts/migrations/update-dreammoon-quantities");
const { main } = require("../scripts/migrate-dreammoon-quantities");

function database() {
  const initial = prepareProducts();
  initial[0].name = "Tên đã sửa";
  initial[0].shopeePrice = 81000;
  initial[0].ads.shopee.percentOverride = 7;
  initial.push({ sku: "BEAR_OTHER", quantity: 99 }, { sku: "DM-CHOCO-NATURE", quantity: 95 });
  const documents = new Map(initial.map((p) => [p.sku, structuredClone(p)]));
  const calls = { indexes: 0, writes: 0 };
  const model = {
    async createIndexes() { calls.indexes++; },
    find({ sku }) { return { select: () => ({ lean: async () => [...documents.values()]
      .filter((p) => sku.$in.includes(p.sku)).map(({ sku, quantity }) => ({ sku, quantity })) }) }; },
    async updateOne(filter, update, options) {
      calls.writes++;
      assert.equal(options.runValidators, true);
      const product = documents.get(filter.sku);
      if (update.$setOnInsert) {
        assert.equal(options.upsert, true);
        if (product) return { upsertedCount: 0 };
        documents.set(filter.sku, structuredClone(update.$setOnInsert));
        return { upsertedCount: 1 };
      }
      assert.equal(options.upsert, undefined);
      if (!product || product.quantity !== filter.quantity) return { matchedCount: 0 };
      Object.assign(product, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
  return { model, documents, calls };
}

test("preview đúng 13 tồn kiểm kê (32 lọ), không tạo SKU hoặc ghi dữ liệu", async () => {
  const db = database();
  const before = structuredClone([...db.documents]);
  const result = await updateQuantities({ model: db.model });
  assert.equal(result.mode, "preview");
  assert.equal(result.totalProducts, 13);
  assert.equal(result.totalQuantity, 32);
  assert.equal(result.pending, 13);
  assert.deepEqual(result.products.map((p) => [p.sku, p.quantity]), [
    ["DREAMMOON_CHOCO_NATURE", 6], ["DREAMMOON_GRAY_BEIGE", 1],
    ["DREAMMOON_BLACK_PASTEL", 3], ["DREAMMOON_BLACK_KELLY", 1],
    ["DREAMMOON_GRAY_TIANA", 3], ["DREAMMOON_GRAY_HELENA", 2],
    ["DREAMMOON_BLACK_MARIO", 1], ["DREAMMOON_GRAY_GREENERY", 2],
    ["DREAMMOON_GRAY_LOUIS", 2], ["DREAMMOON_CHOCO_BELLA", 3],
    ["DREAMMOON_CHOCO_KIMCHI", 4], ["DREAMMOON_CHOCO_OPERA", 3],
    ["DREAMMOON_PINK_SUMMER", 1]
  ]);
  assert.equal(result.products.find((p) => p.sku === "DREAMMOON_GRAY_BEIGE").previousQuantity, null);
  assert.deepEqual([...db.documents], before);
  assert.deepEqual(db.calls, { indexes: 0, writes: 0 });
});

test("apply đặt tồn tuyệt đối, chỉ tạo Gray Beige và giữ các dữ liệu khác", async () => {
  const db = database();
  const before = structuredClone([...db.documents.values()]);
  const result = await updateQuantities({ apply: true, model: db.model });
  assert.equal(result.updated, 12);
  assert.equal(result.created, 1);
  assert.equal(result.pending, 0);
  for (const original of before) {
    const target = result.products.find((p) => p.sku === original.sku);
    assert.deepEqual(db.documents.get(original.sku), target ? { ...original, quantity: target.quantity } : original);
    if (target) assert.equal(target.previousQuantity, original.quantity);
  }
  const beige = db.documents.get("DREAMMOON_GRAY_BEIGE");
  assert.equal(beige.quantity, 1);
  assert.equal(beige.name, "Gray Beige");
  assert.equal(beige.purchasePrice, 25000);
  assert.equal(beige.shopeePrice, 73000);
  assert.equal(beige.tiktokPrice, null);
  assert.deepEqual(beige.ads, { shopee: { enabled: true, percentOverride: null },
    tiktok: { enabled: false, percentOverride: null } });
  assert.equal(new Product(beige).validateSync(), undefined);
  const after = structuredClone([...db.documents]);
  db.calls.writes = 0;
  const repeated = await updateQuantities({ apply: true, model: db.model });
  assert.equal(repeated.unchanged, 13);
  assert.equal(db.calls.writes, 0);
  assert.deepEqual([...db.documents], after);
});

test("Gray Beige đã tồn tại chỉ cập nhật số lượng, giữ giá và cấu hình riêng", async () => {
  const db = database();
  const existing = { sku: "DREAMMOON_GRAY_BEIGE", name: "Grey Beige", quantity: 5,
    purchasePrice: 30000, shopeePrice: 82000, ads: { shopee: { enabled: false } } };
  db.documents.set(existing.sku, structuredClone(existing));
  const result = await updateQuantities({ apply: true, model: db.model });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 13);
  assert.deepEqual(db.documents.get(existing.sku), { ...existing, quantity: 1 });
});

test("thiếu SKU cũ dừng trước mọi thao tác ghi, không tự phục hồi sản phẩm", async () => {
  const db = database();
  db.documents.delete("DREAMMOON_CHOCO_BELLA");
  for (const apply of [false, true]) {
    await assert.rejects(updateQuantities({ apply, model: db.model }), /Thiếu SKU Dreammoon: DREAMMOON_CHOCO_BELLA/);
  }
  assert.deepEqual(db.calls, { indexes: 0, writes: 0 });
});

test("phát hiện tồn thay đổi đồng thời, không báo hoàn tất sai", async () => {
  const db = database();
  const write = db.model.updateOne;
  db.model.updateOne = async (filter, ...args) => {
    db.documents.get(filter.sku).quantity = 9;
    return write(filter, ...args);
  };
  await assert.rejects(updateQuantities({ apply: true, model: db.model }), /đã thay đổi/);
  assert.equal(db.documents.get("DREAMMOON_CHOCO_NATURE").quantity, 9);
});

test("CLI từ chối tham số sai trước khi kết nối DB", async () => {
  await assert.rejects(main(["--aply"]), /Cách dùng/);
});
