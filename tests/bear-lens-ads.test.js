const test = require("node:test");
const assert = require("node:assert/strict");
const { enableAds } = require("../scripts/migrations/enable-bear-lens-shopee-ads");

function database() {
  const documents = [
    { sku: "BEAR_AMBER_BROWN", name: "Amber", quantity: 0, purchasePrice: 27000, shopeePrice: 70000,
      ads: { shopee: { enabled: false, percentOverride: 0 }, tiktok: { enabled: true, percentOverride: 8 } } },
    { sku: "BEAR_RAIN_BROWN", quantity: 2, ads: { shopee: { enabled: false, percentOverride: null } } },
    { sku: "BEAR_APEX_BLUE", quantity: 1, ads: { shopee: { enabled: true, percentOverride: 12 } } },
    { sku: "BEAR_SWEET_GRAY", quantity: 3 },
    { sku: "BEAR_OTHER_LENS", quantity: 7, ads: { shopee: { enabled: false } } },
    { sku: "OTHER_BRAND", quantity: 9, ads: { shopee: { enabled: false } } }
  ];
  const matches = (product, filter) => filter.sku.$in.includes(product.sku) &&
    product.ads?.shopee?.enabled !== filter["ads.shopee.enabled"].$ne;
  let writes = 0;
  const model = {
    async countDocuments(filter) { return documents.filter((product) => matches(product, filter)).length; },
    async updateMany(filter, update, options) {
      writes += 1;
      assert.deepEqual(Object.keys(update.$set), ["ads.shopee.enabled"]);
      assert.equal(options.upsert, undefined);
      const targets = documents.filter((product) => matches(product, filter));
      for (const product of targets) {
        product.ads ??= {};
        product.ads.shopee ??= {};
        product.ads.shopee.enabled = update.$set["ads.shopee.enabled"];
      }
      return { matchedCount: targets.length, modifiedCount: targets.length };
    }
  };
  return { documents, model, get writes() { return writes; } };
}

test("preview Ads đếm đúng SKU cần bật mà không ghi dữ liệu", async () => {
  const db = database();
  const before = structuredClone(db.documents);
  assert.deepEqual(await enableAds({ model: db.model }), { mode: "preview", pending: 3 });
  assert.equal(db.writes, 0);
  assert.deepEqual(db.documents, before);
});

test("bật Ads chỉ cho SKU trong file, giữ giá, tồn, tỷ lệ riêng và TikTok", async () => {
  const db = database();
  const before = structuredClone(db.documents);
  assert.deepEqual(await enableAds({ apply: true, model: db.model }), { mode: "apply", matched: 3, updated: 3 });
  for (let i = 0; i < 4; i += 1) {
    const expected = structuredClone(before[i]);
    expected.ads ??= {};
    expected.ads.shopee ??= {};
    expected.ads.shopee.enabled = true;
    assert.deepEqual(db.documents[i], expected);
  }
  assert.deepEqual(db.documents.slice(4), before.slice(4));
  assert.equal(db.documents.length, before.length);
});

test("chạy lại bước bật Ads không sửa sản phẩm đã bật và không tạo SKU bị thiếu", async () => {
  const db = database();
  await enableAds({ apply: true, model: db.model });
  const before = structuredClone(db.documents);
  assert.deepEqual(await enableAds({ apply: true, model: db.model }), { mode: "apply", matched: 0, updated: 0 });
  assert.deepEqual(db.documents, before);
});
