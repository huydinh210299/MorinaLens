const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Movement = require("../models/ImportAndExport");
const Configuration = require("../models/Configuration");
const { systemKeys } = require("../utils/configuration");
const AppError = require("../utils/errors");
const input = require("../utils/input");

function parseBase(body, create = false) {
  const username = input.text(body.username, "Tên đăng nhập", 60);
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) throw new AppError("Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới và gạch ngang.");
  if (!["admin", "staff"].includes(body.role)) throw new AppError("Vai trò không hợp lệ.");
  const data = { username, role: body.role, active: body.active === "on" };
  const password = String(body.password ?? "");
  if (create && password === "") throw new AppError("Cần nhập mật khẩu.");
  if (password !== "") data.password = password;
  return data;
}
async function create(body) {
  const data = parseBase(body, true);
  data.password = await bcrypt.hash(data.password, 12);
  try { return await User.create(data); }
  catch (error) { if (error.code === 11000) throw new AppError("Tên đăng nhập đã tồn tại."); throw error; }
}
async function update(id, body, actorId) {
  const data = parseBase(body);
  if (String(id) === String(actorId) && (!data.active || data.role !== "admin")) throw new AppError("Không thể tự khóa hoặc hạ quyền tài khoản đang đăng nhập.");
  if (data.password) data.password = await bcrypt.hash(data.password, 12);
  try {
    const user = await User.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!user) throw new AppError("Không tìm thấy nhân viên.", 404);
    return user;
  } catch (error) { if (error.code === 11000) throw new AppError("Tên đăng nhập đã tồn tại."); throw error; }
}
async function remove(id, actorId) {
  if (String(id) === String(actorId)) throw new AppError("Không thể tự xóa tài khoản đang đăng nhập.");
  const user = await User.findById(id);
  if (!user) throw new AppError("Không tìm thấy nhân viên.", 404);
  if (user.orders.length || user.payroll.length || await Movement.exists({ createdBy: id })) throw new AppError("Tài khoản đã có lịch sử đơn hàng, lương hoặc kho; hãy khóa tài khoản thay vì xóa.");
  await user.deleteOne();
}
async function addOrder(id, body) {
  const user = await User.findById(id);
  if (!user) throw new AppError("Không tìm thấy nhân viên.", 404);
  const date = input.date(body.date);
  user.orders.push({ date, amount: input.number(body.amount, "Số đơn", { min: 1, integer: true }) });
  recalculatePayroll(user, date.toISOString().slice(0, 7), await getDefaultOrderRate());
  await user.save();
}
async function removeOrder(id, entryId) {
  const user = await User.findById(id);
  if (!user || !user.orders.id(entryId)) throw new AppError("Không tìm thấy bản ghi đơn hàng.", 404);
  if (user.orders.id(entryId).movement) throw new AppError("Đơn từ phiếu kho đã duyệt; hãy sửa hoặc xóa phiếu kho để cập nhật.");
  const month = user.orders.id(entryId).date.toISOString().slice(0, 7);
  user.orders.id(entryId).deleteOne();
  recalculatePayroll(user, month, await getDefaultOrderRate());
  await user.save();
}
function countOrders(user, month) {
  return user.orders.filter((row) => row.date.toISOString().slice(0, 7) === month).reduce((sum, row) => sum + row.amount, 0);
}
function recalculatePayroll(user, month, defaultRate = systemKeys.ratePerOrder.defaultValue) {
  const orderCount = countOrders(user, month);
  const row = user.payroll.find((entry) => entry.month === month);
  if (!row) {
    if (user.role === "staff" && orderCount > 0) user.payroll.push({ month, orderCount, ratePerOrder: defaultRate, usesDefaultRate: true, amount: orderCount * defaultRate });
    return;
  }
  row.orderCount = orderCount;
  if (row.usesDefaultRate) row.ratePerOrder = defaultRate;
  if (row.ratePerOrder !== null && row.ratePerOrder !== undefined) row.amount = orderCount * row.ratePerOrder;
}
function paidTotal(row) {
  return (row.payments || []).reduce((sum, payment) => sum + payment.amount, 0);
}
async function getDefaultOrderRate(session = null) {
  const row = await Configuration.findOne({ platform: "system", key: "ratePerOrder" }).session(session).lean();
  return row?.value ?? systemKeys.ratePerOrder.defaultValue;
}
async function backfillAutomaticPayroll() {
  const rate = await getDefaultOrderRate();
  const staff = await User.find({ role: "staff" });
  let changed = 0;
  for (const user of staff) {
    const months = new Set(user.orders.map((order) => order.date.toISOString().slice(0, 7)));
    for (const row of user.payroll) if (row.usesDefaultRate) months.add(row.month);
    for (const month of months) recalculatePayroll(user, month, rate);
    if (user.isModified("payroll")) { await user.save(); changed++; }
  }
  return changed;
}
async function refreshDefaultPayrollRate(rate) {
  const staff = await User.find({ role: "staff", "payroll.usesDefaultRate": true });
  for (const user of staff) {
    for (const row of user.payroll) if (row.usesDefaultRate) recalculatePayroll(user, row.month, rate);
    await user.save();
  }
}
async function savePayroll(id, body) {
  const user = await User.findById(id);
  if (!user) throw new AppError("Không tìm thấy nhân viên.", 404);
  const month = input.month(body.month);
  const requestedRate = input.optionalNumber(body.ratePerOrder, "Đơn giá mỗi đơn");
  const hasManualAmount = body.amount !== "" && body.amount !== null && body.amount !== undefined;
  const usesDefaultRate = requestedRate === null && !hasManualAmount;
  const ratePerOrder = usesDefaultRate ? await getDefaultOrderRate() : requestedRate;
  const amount = ratePerOrder === null ? input.number(body.amount, "Lương tháng") : countOrders(user, month) * ratePerOrder;
  const note = input.optionalText(body.note);
  const existing = user.payroll.find((row) => row.month === month);
  if (existing?.payments?.length) throw new AppError("Tháng này đã có thanh toán; số tiền đã trả không thể sửa qua biểu mẫu điều chỉnh.");
  const data = { month, orderCount: countOrders(user, month), ratePerOrder, usesDefaultRate, amount, note };
  if (existing) Object.assign(existing, data);
  else user.payroll.push(data);
  await user.save();
}
async function recordPayrollPayment(id, body, adminId) {
  const month = input.month(body.month);
  const method = String(body.method || "");
  if (!["auto", "manual"].includes(method)) throw new AppError("Cách thanh toán lương không hợp lệ.");
  const manualAmount = method === "manual" ? input.number(body.amount, "Số tiền thanh toán", { min: 1, integer: true }) : null;
  const { runInventory } = require("./inventoryService");
  return runInventory(async (session) => {
    const user = await User.findById(id).session(session);
    if (!user) throw new AppError("Không tìm thấy nhân viên.", 404);
    if (user.role !== "staff") throw new AppError("Chỉ thanh toán lương cho nhân viên.");
    const rate = await getDefaultOrderRate(session);
    let row = user.payroll.find((entry) => entry.month === month);
    if (method === "auto" && row) { row.usesDefaultRate = true; row.ratePerOrder = rate; }
    recalculatePayroll(user, month, rate);
    row = user.payroll.find((entry) => entry.month === month);
    if (!row && method === "manual") {
      user.payroll.push({ month, orderCount: 0, ratePerOrder: rate, usesDefaultRate: true, amount: 0 });
      row = user.payroll[user.payroll.length - 1];
    }
    const amount = method === "auto" ? (row?.amount ?? 0) - (row ? paidTotal(row) : 0) : manualAmount;
    if (amount <= 0) throw new AppError("Tháng này không còn lương tạm tính cần thanh toán tự động.");
    row.payments.push({ amount, method, orderCountAtPayment: row.orderCount, ratePerOrderAtPayment: row.ratePerOrder,
      paidBy: adminId, paidAt: new Date() });
    await user.save({ session });
    return amount;
  });
}
async function removePayroll(id, entryId) {
  const user = await User.findById(id);
  if (!user || !user.payroll.id(entryId)) throw new AppError("Không tìm thấy bảng lương.", 404);
  if (user.payroll.id(entryId).payments.length) throw new AppError("Bảng lương đã có thanh toán nên không thể xóa.");
  if (user.payroll.id(entryId).usesDefaultRate) throw new AppError("Lương tự động được tính từ đơn đã duyệt; hãy chỉnh đơn giá trong cấu hình hoặc sửa số đơn.");
  user.payroll.id(entryId).deleteOne();
  await user.save();
}
module.exports = { create, update, remove, addOrder, removeOrder, savePayroll, recordPayrollPayment, paidTotal, countOrders, recalculatePayroll, getDefaultOrderRate, backfillAutomaticPayroll, refreshDefaultPayrollRate };
