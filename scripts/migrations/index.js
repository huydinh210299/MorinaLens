const { migrate } = require("../migrate-bear-lens");

// Giữ nguyên ID của migration đã phát hành; thêm migration mới ở cuối danh sách.
module.exports = [{
  id: "20261111_001_bear_lens",
  description: "Nhập 43 SKU Bear lens: giá nhập 27.000đ, giá Shopee 70.000đ",
  preview: () => migrate(),
  up: async () => {
    const { products, ...summary } = await migrate({ apply: true });
    return summary;
  }
}, require("./enable-bear-lens-shopee-ads")];
