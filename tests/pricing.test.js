const test = require("node:test");
const assert = require("node:assert/strict");
const { calculate, calculateProduct, calculateLegacy } = require("../services/pricingService");
const { keys } = require("../utils/configuration");

const config = Object.fromEntries(Object.entries(keys).map(([key, meta]) => [key, meta.defaultValue]));
test("giá hòa vốn cho lợi nhuận xấp xỉ không", () => {
  const result = calculate(40000, 7000, config);
  assert.ok(result.profit > 0);
  assert.ok(Math.abs(calculate(result.breakEvenPrice, 7000, config).profit) < 3);
});
test("giá trị thiếu khác với giá bằng không", () => {
  assert.equal(calculate(null, 1000, config), null);
  assert.notEqual(calculate(0, 1000, config), null);
});
test("Ads riêng và voucher shop ảnh hưởng đến lợi nhuận", () => {
  const base = calculate(50000, 10000, config);
  assert.ok(calculate(50000, 10000, config, 20).profit < base.profit);
  assert.ok(calculate(50000, 10000, { ...config, shopVoucher: 2000 }).profit < base.profit);
});
test("giá bán đã gồm thuế, thuế được trừ trong lợi nhuận thay vì cộng vào doanh thu", () => {
  const result = calculate(75000, 25000, config);
  assert.equal(result.sale, 75000);
  assert.equal(result.platformFee, 24000);
  assert.equal(result.tax, 1125);
  assert.equal(result.estimatedPayout, 49875);
  assert.equal(result.ads, 7481.25);
  assert.equal(result.cost, 61231.25);
  assert.equal(result.profit, 13768.75);
  assert.equal(result.profit, result.sale - result.cost);
  const withoutTax = calculate(75000, 25000, { ...config, tax: 0 });
  assert.equal(result.sale, withoutTax.sale);
  assert.ok(Math.abs(withoutTax.profit - result.profit - result.tax * 0.85) < 1e-6);
});

test("voucher giảm doanh thu trước khi tính phí, thuế và giá hòa vốn", () => {
  const discounted = { ...config, shopVoucher: 2000 };
  const result = calculate(75000, 25000, discounted);
  assert.equal(result.sale, 73000);
  assert.ok(Math.abs(calculate(result.breakEvenPrice, 25000, discounted).profit) < 3);
  const fullDiscount = calculate(75000, 25000, { ...config, shopVoucher: 80000 });
  assert.equal(fullDiscount.sale, 0);
  assert.equal(fullDiscount.shopVoucher, 75000);
  assert.equal(fullDiscount.ads, 0);
  assert.equal(fullDiscount.tax, 0);
  assert.ok(fullDiscount.breakEvenPrice > 80000);
});

test("đơn Shopee trong ảnh khớp phụ phí, thuế, thực nhận và cơ sở Ads", () => {
  const result = calculate(72966, 25000, { ...config, shopVoucher: 2000 });
  assert.equal(result.sale, 70966);
  assert.equal(result.fixedFee, 11709);
  assert.equal(result.transactionFee, 4258);
  assert.equal(result.voucherExtra, 3903);
  assert.equal(result.platformFee, 22870);
  assert.equal(result.tax, 1065);
  assert.equal(result.estimatedPayout, 47031);
  assert.equal(result.adsBase, 47031);
  assert.ok(Math.abs(result.ads - 7054.65) < 1e-8);
  assert.ok(Math.abs(result.profit - (result.estimatedPayout - result.ads - 25000 - 2500 - result.risk)) < 1e-8);
  assert.equal(config.shopVoucher, 0);
  assert.equal(config.fixedFee, 16.5);
  assert.equal(keys.shopVoucher.unit, "vnd");
});

test("tiền thực nhận âm không tạo chi phí Ads âm; tổng phí quá cao không có giá hòa vốn", () => {
  const result = calculate(1000, 10000, config);
  assert.ok(result.estimatedPayout < 0);
  assert.equal(result.adsBase, 0);
  assert.equal(result.ads, 0);
  assert.equal(calculate(75000, 10000, { ...config, fixedFee: 100 }).breakEvenPrice, null);
  assert.equal(calculate(75000, 10000, config, 100).breakEvenPrice, null);
});

test("snapshot phiên bản 1 vẫn dùng voucher phần trăm và Ads trên doanh thu cũ", () => {
  const historical = { ...config, fixedFee: 17, shopVoucher: 10 };
  assert.deepEqual(calculate(75000, 25000, historical, 15, 1), calculateLegacy(75000, 25000, historical, 15));
  assert.equal(calculate(75000, 25000, historical, 15, 1).sale, 67500);
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
