const test = require("node:test");
const assert = require("node:assert/strict");
const { parse } = require("../services/inventoryService");

const sample = { type: "export", date: "2026-11-03", platform: "shopee", items: [{ sku: "lens-01", amount: "2" }, { sku: "lens-02", amount: "3" }] };
test("phiếu nhiều SKU chuẩn hóa và kiểm tra số lượng", () => {
  const data = parse({ ...sample, adsPercent: "0" }, "staff");
  assert.deepEqual(data.items.map(({ sku, amount }) => [sku, amount]), [["LENS-01", 2], ["LENS-02", 3]]);
  assert.equal(Object.hasOwn(data, "adsPercent"), false);
  assert.deepEqual(data.items.map((row) => Object.keys(row).sort()), [["amount", "sku"], ["amount", "sku"]]);
});
test("nhân viên không được tạo phiếu nhập", () => {
  assert.throws(() => parse({ ...sample, type: "import" }, "staff"), /Nhân viên chỉ được/);
});
test("từ chối SKU trùng và xuất số lượng không hợp lệ", () => {
  assert.throws(() => parse({ ...sample, items: [sample.items[0], sample.items[0]] }, "admin"), /chỉ được xuất hiện một lần/);
  assert.throws(() => parse({ ...sample, items: [{ sku: "LENS-01", amount: "0" }] }, "admin"), /Số lượng/);
});
test("phiếu hoàn có thể chọn TikTok", () => {
  const data = parse({ ...sample, type: "return", platform: "tiktok" }, "staff");
  assert.equal(data.platform, "tiktok");
  assert.equal(data.items[0].sku, "LENS-01");
});
