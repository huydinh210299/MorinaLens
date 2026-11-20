const User = require("../models/User");
const service = require("../services/userService");
const { paginate, paginateRows } = require("../utils/pagination");
const AppError = require("../utils/errors");

async function index(req, res) {
  const total = await User.countDocuments();
  const { page: currentPage, limit, skip } = paginate(total, req.query.page);
  const items = await User.find().sort({ username: 1, _id: 1 }).skip(skip).limit(limit).lean();
  res.render("pages/users/index", { title: "Nhân viên", items, total, page: currentPage, limit });
}
async function form(req, res) {
  const item = req.params.id ? await User.findById(req.params.id).lean() : null;
  if (req.params.id && !item) throw new AppError("Không tìm thấy nhân viên.", 404);
  res.render("pages/users/form", { title: item ? "Chỉnh sửa nhân viên" : "Thêm nhân viên", item });
}
async function detail(req, res) {
  const item = await User.findById(req.params.id).populate("payroll.payments.paidBy", "username").lean();
  if (!item) throw new AppError("Không tìm thấy nhân viên.", 404);
  item.payroll = item.payroll.map((row) => ({ ...row, paidTotal: service.paidTotal(row) }));
  const payroll = [...item.payroll].sort((a, b) => b.month.localeCompare(a.month));
  res.render("pages/users/detail", { title: `Nhân viên ${item.username}`, item,
    historyBase: `/users/${item._id}`, payrollHistory: paginateRows(payroll, req.query.payrollPage) });
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
