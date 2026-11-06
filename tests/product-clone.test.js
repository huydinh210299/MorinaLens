const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const Product = require("../models/Product");
const service = require("../services/productService");
const { handle } = require("../middleware/errors");

const source = {
  _id: "507f1f77bcf86cd799439011", sku: "LENS-01", name: "Lens gốc", quantity: 99,
  purchasePrice: 25000, shopeePrice: 75000, tiktokPrice: null,
  ads: { shopee: { enabled: true, percentOverride: 0 }, tiktok: { enabled: false, percentOverride: null } },
  note: "Giữ ghi chú", createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-02"), __v: 3
};
const body = { sku: " lens-02 ", name: " Lens mới ", quantity: "4" };
function mockSource(t, value = source) {
  return t.mock.method(Product, "findById", () => ({ lean: async () => structuredClone(value) }));
}

test("nhân bản chỉ lấy ba thông tin mới và giữ cấu hình từ sản phẩm gốc", async (t) => {
  mockSource(t);
  const create = t.mock.method(Product, "create", async (data) => new Product(data));
  const result = await service.clone(source._id, {
    ...body, purchasePrice: 1, shopeePrice: 2, tiktokPrice: 3,
    ads: { shopee: { enabled: false } }, note: "Không được ghi đè", _id: source._id
  });
  assert.deepEqual(create.mock.calls[0].arguments[0], {
    sku: "LENS-02", name: "Lens mới", quantity: 4,
    purchasePrice: source.purchasePrice, shopeePrice: source.shopeePrice, tiktokPrice: null,
    ads: source.ads, note: source.note
  });
  assert.notEqual(String(result._id), source._id);
  assert.equal(result.createdAt, undefined);
  assert.equal(result.validateSync(), undefined);
  assert.equal(source.quantity, 99);
  assert.equal(source.sku, "LENS-01");
});

test("nhân bản giữ giá 0, Ads mặc định hoặc tỷ lệ riêng, cho phép tồn đầu kỳ 0", async (t) => {
  const other = { ...source, shopeePrice: 0, tiktokPrice: 80000,
    ads: { shopee: { enabled: false, percentOverride: 12 }, tiktok: { enabled: true, percentOverride: null } } };
  mockSource(t, other);
  t.mock.method(Product, "create", async (data) => data);
  const result = await service.clone(source._id, { ...body, quantity: "0" });
  assert.equal(result.quantity, 0);
  assert.equal(result.shopeePrice, 0);
  assert.equal(result.tiktokPrice, 80000);
  assert.deepEqual(result.ads, other.ads);
});

test("nhân bản kiểm tra SKU, tên và tồn đầu kỳ trước khi ghi", async (t) => {
  mockSource(t);
  const create = t.mock.method(Product, "create", async (data) => data);
  for (const invalid of [
    { sku: "" }, { sku: "SKU có khoảng trắng" }, { sku: "a".repeat(61) },
    { name: " " }, { name: "a".repeat(151) },
    ...["", undefined, "-1", "1.5", "abc", "Infinity"].map((quantity) => ({ quantity }))
  ]) {
    await assert.rejects(service.clone(source._id, { ...body, ...invalid }), { status: 400 });
  }
  assert.equal(create.mock.callCount(), 0);
});

test("nhân bản báo lỗi khi sản phẩm gốc bị xóa hoặc SKU mới bị trùng", async (t) => {
  const find = mockSource(t, null);
  const create = t.mock.method(Product, "create", async () => { throw Object.assign(new Error("duplicate"), { code: 11000 }); });
  await assert.rejects(service.clone(source._id, body), { status: 404 });
  assert.equal(create.mock.callCount(), 0);
  find.mock.mockImplementation(() => ({ lean: async () => structuredClone(source) }));
  await assert.rejects(service.clone(source._id, body), /SKU đã tồn tại/);
});

test("luồng HTTP nhân bản: form ba ô, lưu thành công và chỉ admin được dùng", async (t) => {
  const find = mockSource(t);
  const create = t.mock.method(Product, "create", async (data) => data);
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "..", "views"));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    const role = req.get("x-test-role");
    req.user = role ? { role } : null;
    res.locals.csrfToken = "test-token";
    next();
  });
  app.use("/products", require("../routes/productRoutes"));
  app.use(handle);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/products/${source._id}/clone`;
  const request = (method, role = "admin") => fetch(url, {
    method, redirect: "manual", headers: role ? { "x-test-role": role } : {},
    ...(method === "POST" ? { body: new URLSearchParams(body) } : {})
  });
  const form = await request("GET");
  assert.equal(form.status, 200);
  const html = await form.text();
  assert.match(html, /LENS-01/);
  assert.match(html, /Lens gốc/);
  assert.match(html, /name="_csrf" value="test-token"/);
  assert.deepEqual([...html.matchAll(/<input(?![^>]*type="hidden")[^>]*name="([^"]+)"/g)].map((match) => match[1]), ["sku", "name", "quantity"]);
  assert.ok(!html.includes('value="99"'));
  const saved = await request("POST");
  assert.equal(saved.status, 302);
  assert.ok(saved.headers.get("location").startsWith("/products?message="));
  assert.equal(create.mock.callCount(), 1);
  assert.equal(create.mock.calls[0].arguments[0].sku, "LENS-02");
  find.mock.resetCalls();
  for (const role of ["staff", null]) {
    for (const method of ["GET", "POST"]) {
      const denied = await request(method, role);
      assert.equal(denied.status, 302);
      assert.ok(denied.headers.get("location").startsWith(role ? "/dashboard?error=" : "/auth/login"));
    }
  }
  assert.equal(find.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 1);
  find.mock.mockImplementation(() => ({ lean: async () => null }));
  assert.equal((await request("GET")).status, 404);
});
