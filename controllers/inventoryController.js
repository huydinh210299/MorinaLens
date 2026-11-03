const Movement = require("../models/ImportAndExport");
const Product = require("../models/Product");
const service = require("../services/inventoryService");
const { page } = require("../utils/input");
const AppError = require("../utils/errors");

async function index(req, res) {
  const type = ["import", "export", "return"].includes(req.query.type) ? req.query.type : "";
  const status = ["pending", "approved"].includes(req.query.status) ? req.query.status : "";
  const platform = ["shopee", "tiktok"].includes(req.query.platform) ? req.query.platform : "";
  const filter = { ...(type ? { type } : {}), ...(status ? { approvalStatus: status } : {}), ...(platform ? { platform } : {}) };
  const currentPage = page(req.query.page), limit = 20;
  const listQuery = Movement.find(filter).populate("createdBy", "username").populate("approvedBy", "username")
    .sort({ createdAt: -1, _id: -1 }).skip((currentPage - 1) * limit).limit(limit);
  if (req.user.role !== "admin") listQuery.select("-items.saleSnapshot");
  const [items, total] = await Promise.all([
    listQuery.lean(),
    Movement.countDocuments(filter)
  ]);
  res.render("pages/inventory/index", { title: "Nhập xuất kho", items, total, page: currentPage, limit, type, status, platform });
}
async function form(req, res) {
  const item = req.params.id ? await Movement.findById(req.params.id).lean() : null;
  if (req.params.id && !item) throw new AppError("Không tìm thấy phiếu kho.", 404);
  const products = await Product.find().sort({ sku: 1 }).select("sku name quantity").lean();
  res.render("pages/inventory/form", { title: item ? "Chỉnh sửa phiếu kho" : "Tạo phiếu kho", item, products });
}
async function create(req, res) { await service.create(req.body, req.user); res.redirect("/inventory?message=" + encodeURIComponent(req.user.role === "staff" ? "Đã tạo phiếu. Chờ admin duyệt trước khi tính công." : "Đã tạo phiếu kho.")); }
async function approve(req, res) { await service.approve(req.params.id, req.user._id); res.redirect("/inventory?status=pending&message=" + encodeURIComponent("Đã duyệt phiếu kho.")); }
async function update(req, res) { await service.update(req.params.id, req.body); res.redirect("/inventory?message=" + encodeURIComponent("Đã cập nhật phiếu kho.")); }
async function remove(req, res) { await service.remove(req.params.id); res.redirect("/inventory?message=" + encodeURIComponent("Đã xóa phiếu kho.")); }
module.exports = { index, form, create, approve, update, remove };
