const Movement = require("../models/ImportAndExport");
const service = require("../services/inventoryService");
const approvalService = require("../services/inventoryApprovalService");
const AppError = require("../utils/errors");

async function index(req, res) {
  res.render("pages/inventory/index", { title: "Kho hàng", ...await approvalService.getReview(req.query) });
}
function redirectApprovals(req, res) {
  const query = new URLSearchParams();
  for (const key of ["date", "status", "type", "platform", "page", "message", "error"]) {
    if (typeof req.query[key] === "string" && req.query[key]) query.set(key, req.query[key]);
  }
  res.redirect("/inventory" + (query.size ? "?" + query : ""));
}
async function approve(req, res) {
  const result = await approvalService.approve(req.body, req.user);
  const query = new URLSearchParams({ message: `Đã duyệt ${result.approvedCount} phiếu kho.` });
  for (const key of ["date", "status", "type", "platform"]) if (result[key]) query.set(key, result[key]);
  res.redirect("/inventory?" + query);
}
async function form(req, res) {
  const item = req.params.id ? await Movement.findById(req.params.id).lean() : null;
  if (req.params.id && !item) throw new AppError("Không tìm thấy phiếu kho.", 404);
  const products = await service.getFormProducts(item);
  res.render("pages/inventory/form", { title: item ? "Chỉnh sửa phiếu kho" : "Tạo phiếu kho", item, products });
}
async function create(req, res) { await service.create(req.body, req.user); res.redirect("/inventory?message=" + encodeURIComponent("Đã tạo phiếu và cập nhật tồn kho. Phiếu đang chờ quản trị viên duyệt.")); }
async function update(req, res) { await service.update(req.params.id, req.body); res.redirect("/inventory?message=" + encodeURIComponent("Đã cập nhật phiếu kho. Phiếu đang chờ quản trị viên duyệt lại.")); }
async function remove(req, res) { await service.remove(req.params.id); res.redirect("/inventory?message=" + encodeURIComponent("Đã xóa phiếu kho.")); }
module.exports = { index, redirectApprovals, approve, form, create, update, remove };
