const test = require("node:test");
const assert = require("node:assert/strict");
const { recalculateSnapshot } = require("../scripts/recalculate-local-sales");
const { calculateLegacy: calculate } = require("../services/pricingService");
const { keys } = require("../utils/configuration");
const config = Object.fromEntries(Object.entries(keys).map(([key, meta]) => [key, meta.defaultValue]));
config.fixedFee = 17;
const old = { listPrice: 75000, unitRevenue: 76124.99999999999, unitCost: 65527.690625,
  unitProfit: 10597.309374999983, adsPercentApplied: 15 };

test("chuyển snapshot cũ sang giá đã gồm thuế và chạy lại không đổi", () => {
  const result = recalculateSnapshot({ ...old, purchasePrice: 25000, config });
  assert.equal(result.unitRevenue, 75000);
  assert.equal(result.unitCost, 65009.375);
  assert.equal(result.unitProfit, 9990.625);
  assert.deepEqual(result.config, config);
  assert.equal(recalculateSnapshot(result), null);
});

test("snapshot có config luôn dùng đầu vào lịch sử kể cả khi cấu hình hiện tại khác", () => {
  const result = recalculateSnapshot({ ...old, purchasePrice: 25000, config }, {
    config: { ...config, tax: 10 }, purchasePrice: 90000
  });
  assert.equal(result.unitRevenue, 75000);
  assert.equal(result.purchasePrice, 25000);
  assert.deepEqual(result.config, config);
});

test("chỉ bổ sung đầu vào cho phiếu cũ khi tái hiện khớp toàn bộ kết quả", () => {
  assert.equal(recalculateSnapshot(old), null);
  assert.equal(recalculateSnapshot(old, { config, purchasePrice: 30000 }), null);
  assert.equal(recalculateSnapshot(old, { config: { ...config, packaging: 9000 }, purchasePrice: 25000 }), null);
  assert.equal(recalculateSnapshot({ ...old, unitProfit: 123 }, { config, purchasePrice: 25000 }), null);
  const result = recalculateSnapshot(old, { config, purchasePrice: 25000 });
  assert.equal(result.purchasePrice, 25000);
  assert.deepEqual(result.config, config);
  assert.equal(result.unitProfit, 9990.625);
});

test("chuyển đúng snapshot có voucher và Ads riêng bằng 0", () => {
  const fees = { ...config, shopVoucher: 10 };
  const previous = calculate(50000 * 1.015, 12000, fees, 0);
  const result = recalculateSnapshot({ listPrice: 50000, purchasePrice: 12000, config: fees,
    adsPercentApplied: 0, unitRevenue: previous.sale, unitCost: previous.cost, unitProfit: previous.profit });
  const expected = calculate(50000, 12000, fees, 0);
  assert.equal(result.unitRevenue, 45000);
  assert.equal(result.unitProfit, expected.profit);
  assert.equal(result.adsPercentApplied, 0);
  assert.equal(recalculateSnapshot(result), null);
});

test("script sửa giá gồm thuế cũ bỏ qua snapshot phiên bản 2", () => {
  assert.equal(recalculateSnapshot({ ...old, pricingVersion: 2, purchasePrice: 25000, config }), null);
});
