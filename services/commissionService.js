const { createHash } = require("node:crypto");
const User = require("../models/User");
const Movement = require("../models/ImportAndExport");
const Configuration = require("../models/Configuration");
const { systemKeys } = require("../utils/configuration");
const { today } = require("../utils/businessDate");
const input = require("../utils/input");
const AppError = require("../utils/errors");

function selectedMonth(value) {
  return input.month(value || today().slice(0, 7));
}
function monthRange(month) {
  input.month(month);
  const [year, number] = month.split("-").map(Number);
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCFullYear(year, number, 1);
  return { $gte: start, $lt: end };
}
async function getPercent(session = null) {
  const row = await Configuration.findOne({ platform: "system", key: "commissionPercent" }).session(session).lean();
  return input.number(row?.value ?? systemKeys.commissionPercent.defaultValue, "Tỷ lệ hoa hồng", { min: 0, max: 100 });
}
function summarize(user, month, movements, percent) {
  const closed = (user.commissions || []).find((row) => row.month === month);
  if (closed) return { ...closed, closed: true, pendingCount: 0, unpricedItems: 0, reviewVersion: "" };
  let revenue = 0, pendingCount = 0, unpricedItems = 0;
  const relevant = movements.filter((row) => String(row.createdBy) === String(user._id)
    && new Date(row.date).toISOString().slice(0, 7) === month
    && row.type === "export" && row.source !== "product_update");
  for (const movement of relevant) {
    if (movement.approvalStatus === "pending") { pendingCount++; continue; }
    if (movement.approvalStatus !== "approved") continue;
    for (const item of movement.items) {
      const unitRevenue = item.saleSnapshot?.unitRevenue;
      if (!Number.isFinite(unitRevenue) || unitRevenue < 0) { unpricedItems += item.amount; continue; }
      revenue += unitRevenue * item.amount;
    }
  }
  const reviewVersion = createHash("sha256").update(JSON.stringify({ user: String(user._id), month, percent,
    rows: relevant.map((row) => [String(row._id), row.updatedAt, row.approvalStatus, row.items])
      .sort((a, b) => a[0].localeCompare(b[0])) })).digest("hex");
  return { month, revenue, percent, amount: Math.round(revenue * percent / 100), closed: false,
    pendingCount, unpricedItems, reviewVersion };
}
async function monthly(users, month, session = null) {
  const loadMovements = () => Movement.find({ createdBy: { $in: users.map((user) => user._id) }, type: "export",
    source: { $ne: "product_update" }, date: monthRange(month) }).session(session).lean();
  // MongoDB transactions do not support concurrent operations on one session.
  const [percent, movements] = session
    ? [await getPercent(session), await loadMovements()]
    : await Promise.all([getPercent(), loadMovements()]);
  return users.map((user) => ({ ...user, commission: summarize(user, month, movements, percent) }));
}
async function close(id, body, actor) {
  if (actor?.role !== "admin") throw new AppError("Chỉ quản trị viên được chốt hoa hồng.", 403);
  const month = input.month(body.month);
  if (month > today().slice(0, 7)) throw new AppError("Không thể chốt hoa hồng tháng trong tương lai.");
  const { runInventory } = require("./inventoryService");
  return runInventory(async (session) => {
    const user = await User.findById(id).session(session).lean();
    if (!user) throw new AppError("Không tìm thấy nhân viên.", 404);
    if (user.role !== "staff") throw new AppError("Chỉ chốt hoa hồng cho nhân viên.");
    const [{ commission }] = await monthly([user], month, session);
    if (commission.closed) throw new AppError("Hoa hồng tháng này đã được chốt.", 409);
    if (commission.pendingCount) throw new AppError("Còn phiếu xuất chờ duyệt trong tháng. Hãy duyệt trước khi chốt hoa hồng.");
    if (commission.unpricedItems) throw new AppError("Có sản phẩm thiếu doanh thu trong phiếu xuất. Hãy kiểm tra trước khi chốt hoa hồng.");
    if (body.reviewVersion !== commission.reviewVersion) throw new AppError("Doanh thu hoặc tỷ lệ hoa hồng đã thay đổi. Hãy tải lại trang, kiểm tra rồi chốt lại.", 409);
    const snapshot = { month, revenue: commission.revenue, percent: commission.percent, amount: commission.amount,
      closedBy: actor._id, closedAt: new Date() };
    // Guard against duplicate closes even across application processes.
    const result = await User.updateOne({ _id: id, role: "staff", "commissions.month": { $ne: month } },
      { $push: { commissions: snapshot } }, { session, runValidators: true });
    if (!result.modifiedCount) throw new AppError("Hoa hồng tháng này đã được chốt hoặc tài khoản đã thay đổi. Hãy tải lại trang.", 409);
    return snapshot;
  });
}
module.exports = { selectedMonth, monthRange, getPercent, summarize, monthly, close };
