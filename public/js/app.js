document.addEventListener("submit", (event) => {
  const message = event.target.dataset.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});
const rows = document.querySelector("#item-rows");
const movementType = document.querySelector('#movement-form [name="type"]');
function refreshStockPreview() {
  if (!rows || !window.InventoryStock) return;
  const products = [...document.querySelectorAll("#sku-list option")].map((option) => ({ sku: option.value, quantity: option.dataset.quantity }));
  const itemRows = [...rows.querySelectorAll(".item-row")];
  const items = itemRows.map((row) => ({ sku: row.querySelector('[name$="[sku]"]').value, amount: row.querySelector('[name$="[amount]"]').value }));
  const previews = window.InventoryStock.project(products, items, movementType.value);
  itemRows.forEach((row, index) => {
    const output = row.querySelector(".stock-preview"), preview = previews[index];
    output.classList.toggle("negative", preview.shortage > 0);
    output.classList.toggle("muted", preview.shortage === 0);
    if (preview.available === null) output.textContent = preview.sku ? "Chọn SKU có trong danh sách để xem tồn ước tính." : "Chọn SKU để xem tồn ước tính.";
    else if (preview.remaining === null) output.textContent = `Tồn trước phiếu: ${preview.available}. Nhập số lượng nguyên từ 1 để xem số còn lại.`;
    else output.textContent = `Tồn trước phiếu: ${preview.available} · Còn lại sau phiếu này: ${preview.remaining}${preview.shortage ? ` · Thiếu ${preview.shortage} sản phẩm.` : ""}`;
  });
}
rows?.addEventListener("input", refreshStockPreview);
rows?.addEventListener("change", refreshStockPreview);
movementType?.addEventListener("change", refreshStockPreview);
document.querySelector("#add-item")?.addEventListener("click", () => {
  const index = Number(rows.dataset.next || 0);
  rows.dataset.next = String(index + 1);
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `<label>SKU<input list="sku-list" name="items[${index}][sku]" required autocomplete="off"></label><label>Số lượng<input type="number" name="items[${index}][amount]" min="1" step="1" required value="1"></label><button type="button" class="button subtle remove-item">Xóa dòng</button><output class="stock-preview muted" aria-live="polite">Chọn SKU để xem tồn ước tính.</output>`;
  rows.append(row);
  row.querySelector("input")?.focus();
  refreshStockPreview();
});
rows?.addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-item")) return;
  if (rows.querySelectorAll(".item-row").length > 1) event.target.closest(".item-row").remove();
  refreshStockPreview();
});
refreshStockPreview();
