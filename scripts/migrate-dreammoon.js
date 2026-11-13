const mongoose = require("mongoose");
const input = require("../utils/input");
const source = require("./data/dreammoon.json");

// Danh sách Dreammoon ngày 12/11/2026: 12 mẫu, tổng tồn đầu kỳ 64 lọ.
// Giá chỉ áp dụng khi tạo SKU mới; chạy lại không sửa sản phẩm đã tồn tại.
function prepareProducts(rows = source) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Danh sách lens không được rỗng.");
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
      purchasePrice: 25000,
      shopeePrice: 73000,
      tiktokPrice: null,
      ads: {
        shopee: { enabled: true, percentOverride: null },
        tiktok: { enabled: false, percentOverride: null }
      },
      note: ""
    };
  });
}

async function migrate({ apply = false, rows = source, model } = {}) {
  // Kiểm tra toàn bộ nguồn trước mọi thao tác database.
  const products = prepareProducts(rows);
  model ??= require("../models/Product");
  // Cần unique index trên SKU để hai lần chạy đồng thời cũng không tạo trùng.
  if (apply) await model.createIndexes();
  const existing = new Set((await model.find({ sku: { $in: products.map((p) => p.sku) } })
    .select("sku").lean()).map((p) => p.sku));
  const summary = {
    mode: apply ? "apply" : "preview",
    totalProducts: products.length,
    totalQuantity: products.reduce((sum, p) => sum + p.quantity, 0),
    created: 0,
    skipped: 0,
    pending: 0,
    products: []
  };
  for (const product of products) {
    let status = "existing";
    if (!existing.has(product.sku)) {
      status = "pending";
      if (apply) {
        const now = new Date();
        const result = await model.updateOne({ sku: product.sku }, {
          $setOnInsert: { ...product, createdAt: now, updatedAt: now }
        }, { upsert: true, runValidators: true, setDefaultsOnInsert: true, timestamps: false });
        // timestamps:false tránh cập nhật updatedAt của SKU đã được tạo đồng thời.
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

async function main(args = process.argv.slice(2)) {
  return require("./migrate").main(args, ["20261112_001_dreammoon"]);
}

module.exports = { prepareProducts, migrate, main };
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    console.error("Nếu đã ghi một phần, có thể chạy lại: SKU đã tồn tại sẽ được bỏ qua.");
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

