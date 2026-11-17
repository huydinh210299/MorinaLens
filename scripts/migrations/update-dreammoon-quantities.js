const { prepareProducts } = require("../migrate-dreammoon");
const source = require("../data/dreammoon-quantities-20261117.json");
const id = "20261117_001_dreammoon_quantities";
const newSku = "DREAMMOON_GRAY_BEIGE";

async function updateQuantities({ apply = false, model } = {}) {
  const targets = prepareProducts(source);
  model ??= require("../../models/Product");
  const existing = new Map((await model.find({ sku: { $in: targets.map((p) => p.sku) } })
    .select("sku quantity").lean()).map((p) => [p.sku, p]));
  // Chỉ Gray Beige là SKU mới được phép tạo; tránh phục hồi nhầm SKU đã xóa.
  const missing = targets.filter((p) => !existing.has(p.sku) && p.sku !== newSku);
  if (missing.length) throw new Error(`Thiếu SKU Dreammoon: ${missing.map((p) => p.sku).join(", ")}. Chạy migration nhập Dreammoon trước.`);
  const summary = {
    mode: apply ? "apply" : "preview", totalProducts: targets.length,
    totalQuantity: targets.reduce((sum, p) => sum + p.quantity, 0),
    created: 0, updated: 0, unchanged: 0, pending: 0, products: []
  };
  if (apply && !existing.has(newSku)) await model.createIndexes();
  for (const target of targets) {
    const previous = existing.get(target.sku);
    let status = previous?.quantity === target.quantity ? "unchanged" : "pending";
    if (apply && status === "pending") {
      if (previous) {
        // Đặt tồn tuyệt đối, giữ giá/Ads và phát hiện tồn thay đổi trong lúc chạy.
        const result = await model.updateOne({ sku: target.sku, quantity: previous.quantity },
          { $set: { quantity: target.quantity } }, { runValidators: true });
        if (result.matchedCount !== 1) throw new Error(`Tồn kho ${target.sku} đã thay đổi trong lúc migration chạy. Kiểm tra lại trước khi chạy tiếp.`);
        status = "updated";
      } else {
        const now = new Date();
        const result = await model.updateOne({ sku: target.sku },
          { $setOnInsert: { ...target, createdAt: now, updatedAt: now } },
          { upsert: true, runValidators: true, setDefaultsOnInsert: true, timestamps: false });
        if (result.upsertedCount !== 1) throw new Error(`SKU ${target.sku} vừa được tạo bởi tiến trình khác. Kiểm tra lại trước khi chạy tiếp.`);
        status = "created";
      }
    }
    summary[status] += 1;
    summary.products.push({ sku: target.sku, name: target.name,
      previousQuantity: previous?.quantity ?? null, quantity: target.quantity, status });
  }
  return summary;
}

module.exports = {
  id,
  description: "Đặt tồn 13 SKU Dreammoon theo kiểm kê 17/11/2026 (32 lọ), thêm Gray Beige",
  preview: () => updateQuantities(),
  up: () => updateQuantities({ apply: true }),
  updateQuantities
};
