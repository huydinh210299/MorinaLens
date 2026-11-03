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
test("giá bán đã gồm thuế, thuế được trừ trong lợi nhuận thay vì cộng vào doanh thu", () => {
  const result = calculate(75000, 25000, config);
  assert.equal(result.sale, 75000);
  assert.ok(Math.abs(result.platformFee - 24375) < 1e-6);
  assert.ok(Math.abs(result.tax - 759.375) < 1e-6);
  assert.equal(result.ads, 11250);
  assert.equal(result.cost, 65009.375);
  assert.equal(result.profit, 9990.625);
  assert.equal(result.profit, result.sale - result.cost);
  const withoutTax = calculate(75000, 25000, { ...config, tax: 0 });
  assert.equal(result.sale, withoutTax.sale);
  assert.ok(Math.abs(withoutTax.profit - result.profit - result.tax) < 1e-6);
});

test("voucher giảm doanh thu trước khi tính phí, thuế và giá hòa vốn", () => {
  const discounted = { ...config, shopVoucher: 10 };
  const result = calculate(75000, 25000, discounted);
  assert.equal(result.sale, 67500);
  assert.ok(Math.abs(calculate(result.breakEvenPrice, 25000, discounted).profit) < 1e-6);
  assert.equal(calculate(75000, 25000, { ...config, shopVoucher: 100 }).sale, 0);
  assert.equal(calculate(75000, 25000, { ...config, shopVoucher: 100 }).breakEvenPrice, null);
});
test("mỗi sàn dùng một giá và Ads riêng", () => {
  const product = { purchasePrice: 10000, shopeePrice: 50000, tiktokPrice: 60000,
    ads: { shopee: { enabled: true, percentOverride: null }, tiktok: { enabled: false, percentOverride: null } } };
  assert.equal(calculateProduct(product, config, "shopee").sale, 50000);
  assert.equal(calculateProduct(product, config, "shopee").adsPercent, 15);
  assert.equal(calculateProduct(product, null, "tiktok"), null);
  assert.equal(calculateProduct(product, config, "tiktok").sale, 60000);
  assert.equal(calculateProduct(product, config, "tiktok").adsPercent, 0);
  product.ads.tiktok = { enabled: true, percentOverride: 8 };
  assert.equal(calculateProduct(product, config, "tiktok").adsPercent, 8);
  product.ads.shopee.percentOverride = 0;
  assert.equal(calculateProduct(product, config, "shopee").adsPercent, 0);
  product.ads.shopee.percentOverride = null;
  assert.equal(calculateProduct(product, config, "shopee").adsPercent, 15);
});
