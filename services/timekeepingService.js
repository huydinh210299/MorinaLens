const User = require("../models/User");
const input = require("../utils/input");
const AppError = require("../utils/errors");
const { countOrders, getDefaultOrderRate, recalculatePayroll, paidTotal } = require("./userService");

function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" }).format(now);
}
function parseEntry(body) {
  const value = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError("Ngày chấm công không hợp lệ.");
  const date = input.date(value, "Ngày chấm công");
  if (date.toISOString().slice(0, 10) !== value) throw new AppError("Ngày chấm công không hợp lệ.");
  if (value > today()) throw new AppError("Không thể chấm công cho ngày trong tương lai.");
  if (typeof body.amount !== "string" && typeof body.amount !== "number") throw new AppError("Số đơn đã đóng không hợp lệ.");
  if (String(body.amount).trim() === "") throw new AppError("Số đơn đã đóng không được để trống.");
  const amount = input.number(body.amount, "Số đơn đã đóng", { min: 0, max: 1000000, integer: true });
  const note = String(body.note ?? "").trim();
  if (note.length > 500) throw new AppError("Ghi chú không được dài quá 500 ký tự.");
  return { date, amount, note };
}
function requireStaff(user) {
  if (!user || user.role !== "staff" || !user.active) throw new AppError("Chỉ nhân viên đang hoạt động được chấm công.", 403);
}
function pendingEntry(user, entryId) {
  const entry = user?.orders.id(entryId);
  if (!entry?.attendance) throw new AppError("Không tìm thấy bản ghi chấm công.", 404);
  if (entry.approved) throw new AppError("Chấm công đã duyệt không thể thay đổi.");
  return entry;
}
function ensureUniqueDay(user, date, entryId = null) {
  if (user.orders.some((row) => row.attendance && String(row._id) !== String(entryId) && row.date.toISOString().slice(0, 10) === date.toISOString().slice(0, 10))) {
    throw new AppError("Bạn đã chấm công ngày này. Hãy chỉnh sửa bản ghi đang chờ duyệt.");
  }
}
async function saveOwn(userId, body, entryId = null) {
  const data = parseEntry(body);
  const { runInventory } = require("./inventoryService");
  await runInventory(async (session) => {
    const user = await User.findById(userId).session(session);
    requireStaff(user);
    const entry = entryId ? pendingEntry(user, entryId) : null;
    ensureUniqueDay(user, data.date, entryId);
    if (entry) Object.assign(entry, data);
    else user.orders.push({ ...data, attendance: true, approved: false });
    await user.save({ session });
  });
  return data.date.toISOString().slice(0, 7);
}
async function cancelOwn(userId, entryId) {
  const { runInventory } = require("./inventoryService");
  return runInventory(async (session) => {
    const user = await User.findById(userId).session(session);
    requireStaff(user);
    const entry = pendingEntry(user, entryId);
    const month = entry.date.toISOString().slice(0, 7);
    entry.deleteOne();
    await user.save({ session });
    return month;
  });
}
async function review(userId, entryId, actor, approve) {
  if (actor.role !== "admin") throw new AppError("Bạn không có quyền duyệt chấm công.", 403);
  const { runInventory } = require("./inventoryService");
  return runInventory(async (session) => {
    const user = await User.findById(userId).session(session);
    const entry = pendingEntry(user, entryId);
    const month = entry.date.toISOString().slice(0, 7);
    if (approve) {
      entry.approved = true;
      entry.approvedBy = actor._id;
      entry.approvedAt = new Date();
      recalculatePayroll(user, month, await getDefaultOrderRate(session));
    } else entry.deleteOne();
    await user.save({ session });
    return month;
  });
}
function selectedMonth(value) { return input.month(value || today().slice(0, 7)); }
function paginate(rows, requestedPage) {
  const limit = 20, total = rows.length;
  const page = Math.min(input.page(requestedPage), Math.max(1, Math.ceil(total / limit)));
  return { items: rows.slice((page - 1) * limit, page * limit), total, page, limit };
}
async function ownData(userId, query) {
  const month = selectedMonth(query.month);
  const [user, defaultOrderRate] = await Promise.all([
    User.findById(userId).populate("orders.approvedBy", "username").lean(), getDefaultOrderRate()
  ]);
  if (!user) throw new AppError("Không tìm thấy nhân viên.", 404);
  const entries = user.orders.filter((row) => row.attendance && row.date.toISOString().slice(0, 7) === month).sort((a, b) => b.date - a.date);
  const payroll = user.payroll.find((row) => row.month === month);
  return { ...paginate(entries, query.page), month, today: today(), isStaff: user.role === "staff",
    orderCount: countOrders(user, month), pendingCount: entries.filter((row) => !row.approved).length,
    approvedCount: entries.filter((row) => row.approved).length, defaultOrderRate,
    salary: payroll?.amount ?? 0, paid: payroll ? paidTotal(payroll) : 0 };
}
async function pendingData(query) {
  const month = selectedMonth(query.month);
  const users = await User.find({ orders: { $elemMatch: { attendance: true, approved: false } } }).select("username orders").lean();
  const rows = users.flatMap((user) => user.orders
    .filter((entry) => entry.attendance && !entry.approved && entry.date.toISOString().slice(0, 7) === month)
    .map((entry) => ({ ...entry, userId: user._id, username: user.username }))
  ).sort((a, b) => a.date - b.date || a.username.localeCompare(b.username));
  return { ...paginate(rows, query.page), month };
}
module.exports = { today, parseEntry, saveOwn, cancelOwn, review, ownData, pendingData };
