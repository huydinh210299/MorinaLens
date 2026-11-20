const { Types } = require("mongoose");
const Product = require("../../models/Product");
const Movement = require("../../models/ImportAndExport");

const id = "20261120_002_replace_daily_lens";
const oldSkus = require("../data/bear-lens-full-1d.json")
  .map(({ sku }) => sku.toUpperCase()).filter((sku) => sku.startsWith("BEAR_1D_"));

// ID cố định để phân biệt bản ghi của migration khi chạy lại sau lỗi.
const targets = [
  ["67a111d04000000000000001", "1D-NAU", "Lens 1 ngày - Nâu", 3],
  ["67a111d04000000000000002", "1D-XAM", "Lens 1 ngày - Xám", 5],
  ["67a111d04000000000000003", "1D-DEN", "Lens 1 ngày - Đen", 2]
].map(([key, sku, name, quantity]) => ({
  _id: new Types.ObjectId(key), sku, name, quantity,
  purchasePrice: 27000, shopeePrice: 70000, tiktokPrice: null,
  ads: { shopee: { enabled: true, percentOverride: null }, tiktok: { enabled: false, percentOverride: null } }
}));

async function replaceDailyLens(apply) {
  const rows = await Product.find({ sku: /1D/i }).select("_id sku name quantity updatedAt").lean();
  const old = rows.filter((row) => oldSkus.includes(row.sku));
  const existing = rows.filter((row) => !oldSkus.includes(row.sku));
  for (const row of existing) {
    const target = targets.find((entry) => entry.sku === row.sku);
    if (!target || String(row._id) !== String(target._id) || row.quantity !== target.quantity) {
      throw new Error(`SKU 1D ngoài kế hoạch hoặc đã thay đổi: ${row.sku}`);
    }
  }
  if (old.length !== oldSkus.length && existing.length !== targets.length) {
    throw new Error("Thiếu SKU nguồn trước khi tạo đủ 3 mã mới. Kiểm tra kho trước khi tiếp tục.");
  }
  if (old.some((row) => row.quantity !== 1)) throw new Error("Tồn SKU 1D cũ đã thay đổi.");
  if (await Movement.exists({ $or: [
    { "items.product": { $in: old.map((row) => row._id) } },
    { "items.sku": { $in: oldSkus } }
  ] })) throw new Error("SKU 1D cũ có phiếu kho liên quan. Cần đối soát trước khi xóa.");

  const summary = { removedSkus: old.map((row) => row.sku), products: targets.map(({ sku, name, quantity }) => ({ sku, name, quantity })) };
  if (!apply) return summary;

  for (const target of targets) {
    if (!existing.some((row) => row.sku === target.sku)) await Product.create(target);
  }
  for (const { _id, sku, quantity, updatedAt } of old) {
    const result = await Product.deleteOne({ _id, sku, quantity, updatedAt });
    if (result.deletedCount !== 1) throw new Error(`SKU thay đổi trong lúc chạy: ${sku}`);
  }
  const after = await Product.find({ sku: /1D/i }).select("_id sku quantity").lean();
  if (after.length !== 3 || !targets.every((t) => after.some((p) =>
    p.sku === t.sku && p.quantity === t.quantity && String(p._id) === String(t._id)))) {
    throw new Error("Kết quả kiểm tra 3 SKU 1D sau migration không khớp.");
  }
  return summary;
}

module.exports = {
  id, description: "Thay 11 SKU lens 1 ngày bằng 3 SKU theo màu (nâu 3, xám 5, đen 2)",
  preview: () => replaceDailyLens(false), up: () => replaceDailyLens(true)
};
