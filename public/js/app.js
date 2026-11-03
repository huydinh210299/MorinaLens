document.addEventListener("submit", (event) => {
  const message = event.target.dataset.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});
const rows = document.querySelector("#item-rows");
document.querySelector("#add-item")?.addEventListener("click", () => {
  const index = Number(rows.dataset.next || 0);
  rows.dataset.next = String(index + 1);
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `<label>SKU<input list="sku-list" name="items[${index}][sku]" required autocomplete="off"></label><label>Số lượng<input type="number" name="items[${index}][amount]" min="1" step="1" required value="1"></label><button type="button" class="button subtle remove-item">Xóa dòng</button>`;
  rows.append(row);
  row.querySelector("input")?.focus();
});
rows?.addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-item")) return;
  if (rows.querySelectorAll(".item-row").length > 1) event.target.closest(".item-row").remove();
});
