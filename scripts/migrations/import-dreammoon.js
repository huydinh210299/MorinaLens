const { migrate } = require("../migrate-dreammoon");

module.exports = {
  id: "20261112_001_dreammoon",
  description: "Nhập 12 SKU Dreammoon, 64 lọ: giá nhập 25.000đ, giá Shopee 73.000đ, bật Ads Shopee",
  preview: () => migrate(),
  up: async () => {
    const { products, ...summary } = await migrate({ apply: true });
    return summary;
  }
};
