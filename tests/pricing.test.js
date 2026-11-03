const test = require("node:test");
const assert = require("node:assert/strict");
const { calculate, calculateProduct } = require("../services/pricingService");

const config = { tax: 1.5, transactionFee: 6, fixedFee: 17, voucherExtra: 5.5, infrastructureFee: 3000, piShip: 0, ads: 15, packaging: 2500, risk: 1.5, shopVoucher: 0 };
test("giá hòa vốn cho lợi nhuận xấp xỉ không", () => {
  const result = calculate(40000, 7000, config);
  assert.ok(result.profit > 0);
  assert.ok(Math.abs(calculate(result.breakEvenPrice, 7000, config).profit) < 1e-6);
});
test("giá trị thiếu khác với giá bằng không", () => {
  assert.equal(calculate(null, 1000, config), null);
  assert.notEqual(calculate(0, 1000, config), null);
});
test("Ads riêng và voucher shop ảnh hưởng đến lợi nhuận", () => {
  const base = calculate(50000, 10000, config);
  assert.ok(calculate(50000, 10000, config, 20).profit < base.profit);
  assert.ok(calculate(50000, 10000, { ...config, shopVoucher: 10 }).profit < base.profit);
});
test("khớp dòng ví dụ trong file Excel khi dùng tham số của chính file", () => {
  const excel = { ...config, packaging: 2000 };
  const result = calculate(33168, 3200, excel);
  assert.ok(Math.abs(result.cost - 23665.546702) < 0.000001);
  assert.ok(Math.abs(result.profit - 9999.973298) < 0.000001);
});
test("mỗi sàn dùng một giá và Ads riêng", () => {
  const product = { purchasePrice: 10000, shopeePrice: 50000, tiktokPrice: 60000,
    ads: { shopee: { enabled: true, percentOverride: null }, tiktok: { enabled: false, percentOverride: null } } };
  assert.ok(Math.abs(calculateProduct(product, config, "shopee").sale - 50750) < 0.000001);
  assert.equal(calculateProduct(product, config, "shopee").adsPercent, 15);
  assert.equal(calculateProduct(product, null, "tiktok"), null);
  assert.ok(Math.abs(calculateProduct(product, config, "tiktok").sale - 60900) < 0.000001);
  assert.equal(calculateProduct(product, config, "tiktok").adsPercent, 0);
  product.ads.tiktok = { enabled: true, percentOverride: 8 };
  assert.equal(calculateProduct(product, config, "tiktok").adsPercent, 8);
  product.ads.shopee.percentOverride = 0;
  assert.equal(calculateProduct(product, config, "shopee").adsPercent, 0);
  product.ads.shopee.percentOverride = null;
  assert.equal(calculateProduct(product, config, "shopee").adsPercent, 15);
});
