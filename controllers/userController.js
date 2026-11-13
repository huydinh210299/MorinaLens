const User = require("../models/User");
const service = require("../services/userService");
const { page } = require("../utils/input");
const AppError = require("../utils/errors");

async function index(req, res) {
  const currentPage = page(req.query.page), limit = 20;
  const [items, total] = await Promise.all([User.find().sort({ username: 1 }).skip((currentPage - 1) * limit).limit(limit).lean(), User.countDocuments()]);
  res.render("pages/users/index", { title: "Nhân viên", items: items.map((item) => ({ ...item, totalOrders: service.countOrders(item) })), total, page: currentPage, limit });
}
async function form(req, res) {
  const item = req.params.id ? await User.findById(req.params.id).lean() : null;
  if (req.params.id && !item) throw new AppError("Không tìm thấy nhân viên.", 404);
  res.render("pages/users/form", { title: item ? "Chỉnh sửa nhân viên" : "Thêm nhân viên", item });
}
async function detail(req, res) {
  const [item, defaultOrderRate] = await Promise.all([
    User.findById(req.params.id).populate("payroll.payments.paidBy", "username").lean(), service.getDefaultOrderRate()
  ]);
  if (!item) throw new AppError("Không tìm thấy nhân viên.", 404);
  item.payroll = item.payroll.map((row) => ({ ...row, paidTotal: service.paidTotal(row) }));
  res.render("pages/users/detail", { title: `Nhân viên ${item.username}`, item, defaultOrderRate, totalOrders: service.countOrders(item) });
}
async function create(req, res) { await service.create(req.body); res.redirect("/users?message=" + encodeURIComponent("Đã thêm nhân viên.")); }
async function update(req, res) { await service.update(req.params.id, req.body, req.user._id); res.redirect("/users?message=" + encodeURIComponent("Đã cập nhật nhân viên.")); }
async function remove(req, res) { await service.remove(req.params.id, req.user._id); res.redirect("/users?message=" + encodeURIComponent("Đã xóa nhân viên.")); }
async function addOrder(req, res) { await service.addOrder(req.params.id, req.body); res.redirect(`/users/${req.params.id}?message=` + encodeURIComponent("Đã ghi nhận số đơn.")); }
async function removeOrder(req, res) { await service.removeOrder(req.params.id, req.params.entryId); res.redirect(`/users/${req.params.id}?message=` + encodeURIComponent("Đã xóa bản ghi đơn.")); }
async function savePayroll(req, res) { await service.savePayroll(req.params.id, req.body); res.redirect(`/users/${req.params.id}?message=` + encodeURIComponent("Đã lưu lương tháng.")); }
async function payPayroll(req, res) { await service.recordPayrollPayment(req.params.id, req.body, req.user._id); res.redirect(`/users/${req.params.id}?message=` + encodeURIComponent("Đã ghi nhận thanh toán lương.")); }
async function removePayroll(req, res) { await service.removePayroll(req.params.id, req.params.entryId); res.redirect(`/users/${req.params.id}?message=` + encodeURIComponent("Đã xóa bảng lương.")); }
module.exports = { index, form, detail, create, update, remove, addOrder, removeOrder, savePayroll, payPayroll, removePayroll };
