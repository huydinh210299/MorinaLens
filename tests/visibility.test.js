const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ejs = require("ejs");

const view = (name, locals) => ejs.renderFile(path.join(__dirname, "..", "views", "pages", name), {
  currentUser: { role: "staff", username: "staff" },
  money: (value) => `${value} đ`,
  dateTime: () => "03/11/2026",
  dateOnly: () => "03/11/2026",
  dateInput: () => "2026-11-03",
  csrfToken: "test-token",
  page: 1, total: 1, limit: 20,
  ...locals
});

test("trang sản phẩm staff chỉ hiện SKU, tên, tồn và hai giá bán", async () => {
  const html = await view("products/index.ejs", {
    q: "", items: [{ _id: "product-id", sku: "LENS-01", name: "Lens demo", quantity: 4,
      shopeePrice: 75000, tiktokPrice: 80000, purchasePrice: 1234567,
      note: "SECRET_NOTE", pricing: { shopee: { profit: 999999 }, tiktok: null } }]
  });
  for (const visible of ["LENS-01", "Lens demo", "75000 đ", "80000 đ", "Giá Shopee", "Giá TikTok"]) assert.match(html, new RegExp(visible));
  for (const hidden of ["Cấu hình giá", "Giá nhập", "Lợi nhuận", "Điểm hòa vốn", "1234567", "SECRET_NOTE", "999999", "Ads:", "Tạo / Cập nhật"]) {
    assert.ok(!html.includes(hidden), `Không được hiển thị ${hidden}`);
  }
});

test("trang phiếu kho staff không hiện ảnh chụp doanh thu và lợi nhuận", async () => {
  const html = await view("inventory/index.ejs", {
    type: "", platform: "", status: "",
    items: [{ _id: "movement-id", type: "export", platform: "shopee", approvalStatus: "approved",
      date: new Date("2026-11-03"), createdAt: new Date(), updatedAt: new Date(), createdBy: { username: "staff" },
      items: [{ sku: "LENS-01", amount: 1, saleSnapshot: { listPrice: 75000, unitRevenue: 76125, unitProfit: 10597, adsPercentApplied: 15 } }] }]
  });
  assert.match(html, /LENS-01/);
  for (const hidden of ["Lợi nhuận", "Doanh thu", "76125", "10597", "Ads:", "Giá bán:"]) {
    assert.ok(!html.includes(hidden), `Không được hiển thị ${hidden}`);
  }
});

test("trang tổng quan staff không hiện trạng thái cấu hình sàn", async () => {
  const html = await view("dashboard/index.ejs", {
    products: 1, lowStock: 0, movements: 1, ordersThisMonth: 1
  });
  assert.match(html, /Xem sản phẩm/);
  assert.ok(!html.includes("Sàn bán hàng"));
  assert.ok(!html.includes("Cấu hình phí"));
});

for (const role of ["admin", "staff"]) {
  test(`danh sách phiếu kho ${role} chỉ hiện SKU và lượng, ghi chú chỉ cho điều chỉnh hoặc hoàn`, async () => {
    const movement = { _id: "movement", type: "export", source: "form", platform: "shopee", approvalStatus: "pending",
      date: new Date("2026-11-03"), items: [{ sku: "LENS-01", amount: 3,
        saleSnapshot: { listPrice: 73111, unitRevenue: 73222, unitProfit: 73333, adsPercentApplied: 17 } }] };
    const html = await view("inventory/index.ejs", { currentUser: { role }, type: "", platform: "", status: "", items: [
      { ...movement, note: "GHI_CHU_XUAT_AN" },
      { ...movement, type: "import", note: "GHI_CHU_NHAP_AN" },
      { ...movement, type: "return", note: "Ghi chú hàng hoàn" },
      { ...movement, source: "product_update", note: "Điều chỉnh tồn <script>bad()</script>" }
    ] });
    assert.match(html, /LENS-01<\/strong> × 3/);
    assert.match(html, /Ghi chú hàng hoàn/);
    assert.match(html, /Điều chỉnh tồn &lt;script&gt;/);
    for (const hidden of ["Giá bán:", "Ads tham khảo", "Doanh thu theo phiếu", "Lợi nhuận theo Ads", "73111", "73222", "73333", "GHI_CHU_XUAT_AN", "GHI_CHU_NHAP_AN", "<script>bad"]) {
      assert.ok(!html.includes(hidden), `Không được hiển thị ${hidden}`);
    }
  });
}

test("form phiếu có số tồn cho từng SKU và vùng hiển thị ước tính", async () => {
  const html = await view("inventory/form.ejs", { title: "Tạo phiếu kho", item: null,
    products: [{ sku: "LENS-01", name: "Lens", quantity: 8, availableQuantity: 8 }] });
  assert.match(html, /data-quantity="8"/);
  assert.match(html, /class="stock-preview muted" aria-live="polite"/);
  assert.match(html, /Số tồn đã tính cả phiếu đang chờ duyệt/);
});
