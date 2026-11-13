(function (root) {
  function normalizeSku(value) { return String(value || "").trim().toUpperCase(); }
  function project(products, items, type) {
    const quantities = new Map(products.map((product) => [normalizeSku(product.sku), Number(product.quantity)]));
    const totals = new Map();
    for (const item of items) {
      const sku = normalizeSku(item.sku), amount = Number(item.amount);
      const total = totals.get(sku) || { amount: 0, valid: true };
      if (!Number.isSafeInteger(amount) || amount < 1) total.valid = false;
      else total.amount += amount;
      totals.set(sku, total);
    }
    return items.map((item) => {
      const sku = normalizeSku(item.sku), available = quantities.get(sku), total = totals.get(sku);
      const known = Number.isFinite(available);
      const valid = known && total.valid && ["export", "import", "return"].includes(type);
      const remaining = valid ? available + (type === "export" ? -1 : 1) * total.amount : null;
      return { sku, available: known ? available : null, remaining, shortage: remaining !== null && remaining < 0 ? -remaining : 0 };
    });
  }
  const api = { project };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.InventoryStock = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
