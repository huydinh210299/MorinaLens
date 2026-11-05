const Configuration = require("../models/Configuration");

async function migratePricingConfiguration() {
  // Chạy một lần cho phí cố định; các lần khởi động sau giữ chỉnh sửa của admin.
  await Configuration.updateOne(
    { platform: "shopee", key: "fixedFee", pricingRevision: { $ne: 2 } },
    { $set: { value: 16.5, pricingRevision: 2 } }
  );
  // Không diễn giải tỷ lệ voucher cũ thành số tiền. Khởi tạo lại bằng 0đ.
  await Configuration.updateMany(
    { platform: { $in: ["shopee", "tiktok"] }, key: "shopVoucher", unit: "percent" },
    { $set: { value: 0, unit: "vnd" } }
  );
}

module.exports = { migratePricingConfiguration };
