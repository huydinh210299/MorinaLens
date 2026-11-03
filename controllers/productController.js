const Product = require("../models/Product");
const service = require("../services/productService");
const pricing = require("../services/pricingService");
const { page } = require("../utils/input");
const AppError = require("../utils/errors");
const { keys } = require("../utils/configuration");

async function index(req, res) {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const filter = q ? { $or: [{ sku: { $regex: escapeRegex(q), $options: "i" } }, { name: { $regex: escapeRegex(q), $options: "i" } }] } : {};
  const currentPage = page(req.query.page), limit = 20;
  const isAdmin = req.user.role === "admin";
  const query = Product.find(filter).sort({ updatedAt: -1 }).skip((currentPage - 1) * limit).limit(limit);
  if (!isAdmin) query.select("sku name quantity shopeePrice tiktokPrice");
  const [items, total] = await Promise.all([query.lean(), Product.countDocuments(filter)]);
  if (!isAdmin) {
    return res.render("pages/products/index", { title: "Sản phẩm", items, total, page: currentPage, limit, q });
  }
  const [shopee, tiktok] = await Promise.all([pricing.getConfig(), pricing.getConfig("tiktok")]);
  res.render("pages/products/index", { title: "Sản phẩm",
    items: items.map((item) => ({ ...item, pricing: { shopee: pricing.calculateProduct(item, shopee, "shopee"), tiktok: pricing.calculateProduct(item, tiktok, "tiktok") } })),
    total, page: currentPage, limit, q, shopee, tiktok, configKeys: keys, hasCompleteConfig: pricing.hasCompleteConfig });
}
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
async function form(req, res) {
  const [item, shopeeConfig, tiktokConfig] = await Promise.all([
    req.params.id ? Product.findById(req.params.id).lean() : Promise.resolve(null),
    pricing.getConfig("shopee"), pricing.getConfig("tiktok")
  ]);
  if (req.params.id && !item) throw new AppError("Không tìm thấy sản phẩm.", 404);
  res.render("pages/products/form", { title: item ? "Chỉnh sửa sản phẩm" : "Thêm sản phẩm", item,
    adsDefaults: { shopee: shopeeConfig?.ads, tiktok: tiktokConfig?.ads } });
}
async function create(req, res) { await service.create(req.body); res.redirect("/products?message=" + encodeURIComponent("Đã thêm sản phẩm.")); }
async function update(req, res) { await service.update(req.params.id, req.body, req.user); res.redirect("/products?message=" + encodeURIComponent("Đã cập nhật sản phẩm.")); }
async function remove(req, res) { await service.remove(req.params.id); res.redirect("/products?message=" + encodeURIComponent("Đã xóa sản phẩm.")); }
module.exports = { index, form, create, update, remove };
