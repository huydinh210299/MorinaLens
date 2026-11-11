const { prepareProducts } = require("../migrate-bear-lens");

async function enableAds({ apply = false, model } = {}) {
  model ??= require("../../models/Product");
  const filter = {
    sku: { $in: prepareProducts().map((product) => product.sku) },
    "ads.shopee.enabled": { $ne: true }
  };
  if (!apply) return { mode: "preview", pending: await model.countDocuments(filter) };
  // Chỉ đổi cờ Ads Shopee của các SKU trong file, giữ tỷ lệ riêng và dữ liệu khác.
  const result = await model.updateMany(filter, { $set: { "ads.shopee.enabled": true } }, { runValidators: true });
  return { mode: "apply", matched: result.matchedCount, updated: result.modifiedCount };
}

module.exports = {
  id: "20261111_002_bear_lens_shopee_ads",
  description: "Bật Ads Shopee cho 43 SKU trong danh sách Bear lens",
  preview: () => enableAds(),
  up: () => enableAds({ apply: true }),
  enableAds
};
