const input = require("../../utils/input");
const source = require("../data/lens-accessories-20261118.json");
const id = "20261118_001_lens_accessories";

function prepareProducts(rows = source) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Danh sách sản phẩm không được rỗng.");
  const seen = new Set();
  return rows.map((row) => {
    const sku = input.text(row.sku, "SKU", 60).toUpperCase();
    if (!/^[A-Z0-9._-]+$/.test(sku)) throw new Error(`SKU không hợp lệ: ${sku}`);
    if (seen.has(sku)) throw new Error(`SKU trùng trong dữ liệu nguồn: ${sku}`);
    seen.add(sku);
    return {
      sku,
      name: input.text(row.name, "Tên sản phẩm"),
      quantity: input.number(row.quantity, "Tồn đầu kỳ", { integer: true }),
      purchasePrice: input.number(row.purchasePrice, "Giá nhập"),
      shopeePrice: input.number(row.shopeePrice, "Giá Shopee"),
      tiktokPrice: null,
      ads: {
        shopee: { enabled: false, percentOverride: null },
        tiktok: { enabled: false, percentOverride: null }
      },
      note: ""
    };
  });
}

async function importProducts({ apply = false, rows = source, model } = {}) {
  // Kiểm tra toàn bộ nguồn trước khi truy cập database.
  const products = prepareProducts(rows);
  model ??= require("../../models/Product");
  if (apply) await model.createIndexes();
  const existing = new Set((await model.find({ sku: { $in: products.map((p) => p.sku) } })
    .select("sku").lean()).map((p) => p.sku));
  const summary = {
    mode: apply ? "apply" : "preview", totalProducts: products.length,
    totalQuantity: products.reduce((sum, p) => sum + p.quantity, 0),
    created: 0, skipped: 0, pending: 0, products: []
  };
  for (const product of products) {
    let status = "existing";
    if (!existing.has(product.sku)) {
      status = "pending";
      if (apply) {
        const now = new Date();
        // Chỉ đặt tồn đầu kỳ khi tạo mới; không cộng tồn hoặc sửa SKU đã tồn tại.
        const result = await model.updateOne({ sku: product.sku }, {
          $setOnInsert: { ...product, createdAt: now, updatedAt: now }
        }, { upsert: true, runValidators: true, setDefaultsOnInsert: true, timestamps: false });
        status = result.upsertedCount === 1 ? "created" : "existing";
      }
    }
    if (status === "existing") summary.skipped += 1;
    else if (status === "created") summary.created += 1;
    else summary.pending += 1;
    summary.products.push({ ...product, status });
  }
  return summary;
}

module.exports = {
  id,
  description: "Nhập 4 sản phẩm phụ trợ lens, tổng tồn 219, tắt Ads cả Shopee và TikTok",
  preview: () => importProducts(),
  up: () => importProducts({ apply: true }),
  prepareProducts,
  importProducts
};
