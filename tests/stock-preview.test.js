const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Product = require("../models/Product");
const { getFormProducts } = require("../services/inventoryService");
const stock = require("../public/js/stock-preview");

function mockProducts(t, products) {
  t.mock.method(Product, "find", () => ({ sort() { return this; }, select() { return this; }, lean: async () => products }));
}
test("tồn cho phiếu mới đã tính các phiếu đang chờ, không trừ thêm lần nữa", async (t) => {
  // 10 ban đầu, phiếu xuất đang chờ đã trừ 2 còn 8 trong database.
  mockProducts(t, [{ _id: "p1", sku: "LENS-01", quantity: 8 }]);
  const products = await getFormProducts();
  assert.equal(products[0].availableQuantity, 8);
  const [preview] = stock.project([{ sku: "LENS-01", quantity: products[0].availableQuantity }], [{ sku: " lens-01 ", amount: "3" }], "export");
  assert.equal(preview.remaining, 5);
  assert.equal(preview.shortage, 0);
});

test("chỉnh sửa phiếu xuất hoàn lại tác động phiếu cũ trước khi ước tính phiếu thay thế", async (t) => {
  mockProducts(t, [{ _id: "p1", sku: "LENS-01", quantity: 5 }, { _id: "p2", sku: "LENS-02", quantity: 10 }]);
  const products = await getFormProducts({ type: "export", items: [{ product: "p1", amount: 3 }] });
  assert.equal(products[0].availableQuantity, 8);
  assert.equal(products[1].availableQuantity, 10);
  const quantities = products.map((row) => ({ sku: row.sku, quantity: row.availableQuantity }));
  assert.equal(stock.project(quantities, [{ sku: "LENS-01", amount: 4 }], "export")[0].remaining, 4);
  assert.equal(stock.project(quantities, [{ sku: "LENS-01", amount: 3 }], "return")[0].remaining, 11);
});

test("sửa phiếu nhập hoặc hoàn không cộng lại lượng hàng của bản cũ", async (t) => {
  mockProducts(t, [{ _id: "p1", sku: "LENS-01", quantity: 9 }]);
  for (const type of ["import", "return"]) {
    const [product] = await getFormProducts({ type, items: [{ product: "p1", amount: 4 }] });
    assert.equal(product.availableQuantity, 5);
    assert.equal(stock.project([{ sku: product.sku, quantity: product.availableQuantity }], [{ sku: product.sku, amount: 6 }], type)[0].remaining, 11);
  }
});

test("tính chung các dòng cùng SKU, báo thiếu và bỏ qua số lượng không hợp lệ", () => {
  const products = [{ sku: "LENS-01", quantity: 5 }];
  const previews = stock.project(products, [{ sku: "LENS-01", amount: 4 }, { sku: "lens-01", amount: 3 }], "export");
  assert.ok(previews.every((row) => row.remaining === -2 && row.shortage === 2));
  assert.equal(stock.project(products, [{ sku: "MISSING", amount: 1 }], "export")[0].available, null);
  for (const amount of ["", " ", 0, -1, 1.5, "abc"]) {
    assert.equal(stock.project(products, [{ sku: "LENS-01", amount }], "export")[0].remaining, null);
  }
  assert.equal(stock.project(products, [{ sku: "LENS-01", amount: 5 }], "export")[0].remaining, 0);
});

test("form cập nhật tồn khi nhập số lượng, đổi loại phiếu và xóa dòng", () => {
  const handlers = {}, typeHandlers = {};
  const makeRow = (sku, amount) => {
    const skuInput = { value: sku }, amountInput = { value: amount };
    const output = { textContent: "", classList: { toggle() {} } };
    return { skuInput, amountInput, output, querySelector: (selector) => selector === ".stock-preview" ? output : selector.includes("[sku]") ? skuInput : amountInput };
  };
  const itemRows = [makeRow("LENS-01", "3")];
  const rows = { querySelectorAll: () => itemRows, addEventListener: (name, handler) => { handlers[name] = handler; } };
  const type = { value: "export", addEventListener: (name, handler) => { typeHandlers[name] = handler; } };
  const document = {
    addEventListener() {},
    querySelector: (selector) => selector === "#item-rows" ? rows : selector.includes('[name="type"]') ? type : null,
    querySelectorAll: () => [{ value: "LENS-01", dataset: { quantity: "8" } }]
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8"), { document, window: { InventoryStock: stock } });
  assert.match(itemRows[0].output.textContent, /Còn lại sau phiếu này: 5/);
  itemRows[0].amountInput.value = "5";
  handlers.input();
  assert.match(itemRows[0].output.textContent, /Còn lại sau phiếu này: 3/);
  type.value = "return";
  typeHandlers.change();
  assert.match(itemRows[0].output.textContent, /Còn lại sau phiếu này: 13/);
  type.value = "export";
  const second = makeRow("LENS-01", "4");
  itemRows.push(second);
  handlers.input();
  assert.match(second.output.textContent, /Thiếu 1 sản phẩm/);
  handlers.click({ target: { classList: { contains: () => true }, closest: () => ({ remove: () => itemRows.pop() }) } });
  assert.match(itemRows[0].output.textContent, /Còn lại sau phiếu này: 3/);
});
