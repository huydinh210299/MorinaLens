const pricing = require("../services/pricingService");
const { keys } = require("../utils/configuration");

async function index(req, res) {
  const [shopee, tiktok] = await Promise.all([pricing.getConfig("shopee"), pricing.getConfig("tiktok")]);
  // Ví dụ cố định để đối chiếu được với ảnh Shopee, độc lập với cấu hình đang dùng.
  const exampleConfig = { tax: 1.5, transactionFee: 6, fixedFee: 16.5, voucherExtra: 5.5,
    infrastructureFee: 3000, piShip: 0, ads: 15, packaging: 2500, risk: 1.5, shopVoucher: 2000 };
  const example = { price: 72966, purchasePrice: 25000, config: exampleConfig,
    result: pricing.calculate(72966, 25000, exampleConfig) };
  res.render("pages/guide/index", { title: "Hướng dẫn", keys, shopee, tiktok, example,
    preciseMoney: (value) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value) + " ₫" });
}

module.exports = { index };
