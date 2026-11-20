const id = "20261120_001_bear_lens_received_products";
const replacements = [
  { previousSku: "BEAR_CLOUDY_GRAY", sku: "BEAR_SNOW_BUBBLE_GRAY", name: "Snow Bubble Gray" },
  { previousSku: "BEAR_MALLOW_BROWN", sku: "BEAR_SWEET_MOCHI_BROWN", name: "Sweet Mochi Brown" }
];

async function correctProducts({ apply = false, model, movementModel } = {}) {
  model ??= require("../../models/Product");
  const skus = replacements.flatMap(({ previousSku, sku }) => [previousSku, sku]);
  const existing = new Map((await model.find({ sku: { $in: skus } })
    .select("_id sku name quantity").lean()).map((product) => [product.sku, product]));
  // Kiểm tra cả hai cặp trước khi ghi; không gộp tồn hoặc tạo lại SKU bị thiếu.
  const plan = replacements.map((target) => {
    const previous = existing.get(target.previousSku);
    const renamed = existing.get(target.sku);
    if (previous && renamed) throw new Error(`SKU đích ${target.sku} đã tồn tại; cần kiểm tra trước khi đổi ${target.previousSku}.`);
    if (!previous && !renamed) throw new Error(`Thiếu SKU ${target.previousSku} và ${target.sku}. Chạy migration nhập Bear lens trước.`);
    if (!previous && renamed.name !== target.name) throw new Error(`Tên SKU ${target.sku} không khớp; cần kiểm tra trước khi chạy tiếp.`);
    return { ...target, product: previous || renamed, needsRename: !!previous };
  });
  const summary = { mode: apply ? "apply" : "preview", updated: 0, unchanged: 0, pending: 0,
    movementsUpdated: 0, products: [] };
  if (apply) {
    movementModel ??= require("../../models/ImportAndExport");
    await model.createIndexes();
  }
  for (const { previousSku, sku, name, product, needsRename } of plan) {
    let status = needsRename ? "pending" : "unchanged";
    if (apply && needsRename) {
      const result = await model.updateOne({ _id: product._id, sku: previousSku, name: product.name },
        { $set: { sku, name } }, { runValidators: true });
      if (result.matchedCount !== 1) throw new Error(`SKU ${previousSku} đã thay đổi trong lúc migration chạy. Kiểm tra lại trước khi chạy tiếp.`);
      status = "updated";
    }
    if (apply) {
      // Chạy cả khi sản phẩm đã đổi tên: phục hồi được lỗi giữa bước đổi SKU và sửa phiếu.
      // Chỉ sửa SKU của đúng product ID, giữ nguyên lượng, giá snapshot và trạng thái duyệt.
      const result = await movementModel.updateMany(
        { items: { $elemMatch: { product: product._id, sku: previousSku } } },
        { $set: { "items.$[item].sku": sku } },
        { arrayFilters: [{ "item.product": product._id, "item.sku": previousSku }],
          runValidators: true, timestamps: false });
      summary.movementsUpdated += result.modifiedCount;
    }
    summary[status] += 1;
    summary.products.push({ previousSku, sku, name, quantity: product.quantity, status });
  }
  return summary;
}

module.exports = {
  id,
  description: "Sửa hàng Bear lens thực nhận: Cloudy Gray → Snow Bubble Gray, Mallow Brown → Sweet Mochi Brown",
  preview: () => correctProducts(),
  up: () => correctProducts({ apply: true }),
  correctProducts
};
