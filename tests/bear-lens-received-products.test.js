const test = require("node:test");
const assert = require("node:assert/strict");
const { correctProducts } = require("../scripts/migrations/correct-bear-lens-products");
const { main } = require("../scripts/migrate-bear-lens-received-products");

function database() {
  const products = [
    { _id: "gray", sku: "BEAR_CLOUDY_GRAY", name: "Cloudy Gray", quantity: 2,
      purchasePrice: 27000, shopeePrice: 70000, ads: { shopee: { enabled: true } } },
    { _id: "brown", sku: "BEAR_MALLOW_BROWN", name: "Mallow Brown", quantity: 0 },
    { _id: "other", sku: "BEAR_OTHER", name: "Other", quantity: 8 }
  ];
  const movements = [{ items: [
    { product: "gray", sku: "BEAR_CLOUDY_GRAY", amount: 1, saleSnapshot: { unitProfit: 10000 } },
    { product: "brown", sku: "BEAR_MALLOW_BROWN", amount: 2 },
    { product: "other", sku: "BEAR_CLOUDY_GRAY", amount: 3 }
  ], approvalStatus: "approved" }];
  const calls = { writes: 0, indexes: 0, movements: 0 };
  const model = {
    find: ({ sku }) => ({ select: () => ({ lean: async () => structuredClone(products.filter((p) => sku.$in.includes(p.sku))) }) }),
    async createIndexes() { calls.indexes++; },
    async updateOne(filter, update, options) {
      calls.writes++;
      assert.equal(options.runValidators, true);
      const product = products.find((p) => p._id === filter._id && p.sku === filter.sku && p.name === filter.name);
      if (!product) return { matchedCount: 0 };
      Object.assign(product, update.$set);
      return { matchedCount: 1 };
    }
  };
  const movementModel = { async updateMany(filter, update, options) {
    calls.movements++;
    const match = filter.items.$elemMatch;
    assert.deepEqual(options.arrayFilters, [{ "item.product": match.product, "item.sku": match.sku }]);
    assert.equal(options.timestamps, false);
    let modifiedCount = 0;
    for (const movement of movements) {
      let changed = false;
      for (const item of movement.items) {
        if (item.product === match.product && item.sku === match.sku) {
          item.sku = update.$set["items.$[item].sku"];
          changed = true;
        }
      }
      if (changed) modifiedCount++;
    }
    return { modifiedCount };
  } };
  return { products, movements, model, movementModel, calls };
}

test("preview liệt kê đúng hai cặp đổi, không ghi hoặc tạo index", async () => {
  const db = database();
  const before = structuredClone(db.products);
  const result = await correctProducts(db);
  assert.equal(result.pending, 2);
  assert.deepEqual(result.products.map((p) => [p.previousSku, p.sku, p.name]), [
    ["BEAR_CLOUDY_GRAY", "BEAR_SNOW_BUBBLE_GRAY", "Snow Bubble Gray"],
    ["BEAR_MALLOW_BROWN", "BEAR_SWEET_MOCHI_BROWN", "Sweet Mochi Brown"]
  ]);
  assert.deepEqual(db.products, before);
  assert.deepEqual(db.calls, { writes: 0, indexes: 0, movements: 0 });
});

test("đổi cùng ID, giữ tồn/giá/Ads, sửa đúng dòng phiếu và chạy lại không đổi dữ liệu", async () => {
  const db = database();
  const before = structuredClone(db.products);
  const history = structuredClone(db.movements);
  const result = await correctProducts({ ...db, apply: true });
  assert.equal(result.updated, 2);
  assert.equal(result.movementsUpdated, 2);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(db.products[i], { ...before[i], sku: result.products[i].sku, name: result.products[i].name });
    history[0].items[i].sku = result.products[i].sku;
  }
  assert.deepEqual(db.products[2], before[2]);
  assert.deepEqual(db.movements, history);
  const repeated = await correctProducts({ ...db, apply: true });
  assert.equal(repeated.unchanged, 2);
  assert.equal(repeated.movementsUpdated, 0);
  assert.equal(db.calls.writes, 2);
});

test("thiếu SKU hoặc trùng SKU đích ở cặp thứ hai đều dừng trước khi ghi", async () => {
  for (const conflict of [false, true]) {
    const db = database();
    if (conflict) db.products.push({ _id: "duplicate", sku: "BEAR_SWEET_MOCHI_BROWN" });
    else db.products.splice(1, 1);
    await assert.rejects(correctProducts({ ...db, apply: true }), conflict ? /đã tồn tại/ : /Thiếu SKU/);
    assert.deepEqual(db.calls, { writes: 0, indexes: 0, movements: 0 });
  }
});

test("chạy lại sau lỗi sửa phiếu tiếp tục được, không đặt lại tồn đã thay đổi", async () => {
  const db = database();
  const update = db.movementModel.updateMany;
  db.movementModel.updateMany = async () => { throw new Error("Mất kết nối"); };
  await assert.rejects(correctProducts({ ...db, apply: true }), /Mất kết nối/);
  assert.equal(db.products[0].sku, "BEAR_SNOW_BUBBLE_GRAY");
  db.products[0].quantity = 1;
  db.movementModel.updateMany = update;
  const result = await correctProducts({ ...db, apply: true });
  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(result.movementsUpdated, 2);
  assert.equal(db.products[0].quantity, 1);
});

test("phát hiện sản phẩm đổi đồng thời và không sửa phiếu khi đổi SKU thất bại", async () => {
  const db = database();
  db.model.updateOne = async () => ({ matchedCount: 0 });
  await assert.rejects(correctProducts({ ...db, apply: true }), /đã thay đổi/);
  assert.equal(db.calls.movements, 0);
});

test("CLI từ chối tham số sai trước kết nối database", async () => {
  await assert.rejects(main(["--aply"]), /Cách dùng/);
});
