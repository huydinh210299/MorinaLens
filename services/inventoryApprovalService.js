const { createHash, randomUUID } = require("node:crypto");
const Movement = require("../models/ImportAndExport");
const InventoryApproval = require("../models/InventoryApproval");
const AppError = require("../utils/errors");
const { paginateRows } = require("../utils/pagination");
const { today, parseDay, dayRange } = require("../utils/businessDate");
const { runInventory } = require("./inventoryService");

function reviewVersion(pending, approvals, filters) {
  const rows = pending.map((row) => [String(row._id), row.updatedAt, row.type, row.date, row.platform, row.items, row.note, row.createdBy?._id || row.createdBy]);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const batches = approvals.map((row) => [String(row._id), row.batchId, row.updatedAt]).sort((a, b) => a[0].localeCompare(b[0]));
  return createHash("sha256").update(JSON.stringify({ rows, batches, filters })).digest("hex");
}
function approvalDate(value) {
  const date = parseDay(value);
  if (date.toISOString().slice(0, 10) > today()) throw new AppError("Không thể duyệt phiếu kho của ngày trong tương lai.");
  return date;
}
function parse(body) {
  const filters = selectedFilters(body);
  const note = String(body.note ?? "").trim();
  if (note.length > 500) throw new AppError("Ghi chú không được dài quá 500 ký tự.");
  if (!/^[a-f0-9]{64}$/.test(String(body.reviewVersion || ""))) throw new AppError("Hãy tải lại trang duyệt phiếu kho trước khi duyệt.");
  return { ...filters, note };
}
function selectedDate(value) {
  return value === undefined || value === "" ? "" : approvalDate(value).toISOString().slice(0, 10);
}
function selectedChoice(value, choices, label) {
  if (value === undefined || value === "") return "";
  if (!choices.includes(value)) throw new AppError(`${label} không hợp lệ.`);
  return value;
}
function selectedFilters(values) {
  return { date: selectedDate(values.date),
    status: selectedChoice(values.status, ["pending", "approved"], "Trạng thái duyệt"),
    type: selectedChoice(values.type, ["import", "export", "return"], "Loại phiếu"),
    platform: selectedChoice(values.platform, ["shopee", "tiktok"], "Sàn bán hàng") };
}
function movementFilter(filters, status = filters.status) {
  return { ...(filters.date ? { date: dayRange(filters.date) } : {}),
    ...(status ? { approvalStatus: status } : {}), ...(filters.type ? { type: filters.type } : {}),
    ...(filters.platform ? { platform: filters.platform } : {}) };
}
async function getReview(query = {}) {
  const filters = selectedFilters(query);
  const { date } = filters;
  const [movements, approvals] = await Promise.all([
    Movement.find(movementFilter(filters)).select("-items.saleSnapshot").populate("createdBy approvedBy", "username").sort({ date: -1, createdAt: -1, _id: -1 }).lean(),
    InventoryApproval.find(date ? { date: new Date(date) } : {}).populate("reviewedBy", "username").sort({ reviewedAt: -1, _id: -1 }).lean()
  ]);
  const pending = movements.filter((row) => row.approvalStatus === "pending");
  return { ...filters, ...paginateRows(movements, query.page), today: today(), approval: approvals[0] || null, pendingCount: pending.length,
    approvedCount: movements.filter((row) => row.approvalStatus === "approved").length,
    counts: Object.fromEntries(["import", "export", "return"].map((type) => [type, pending.filter((row) => row.type === type).length])),
    reviewVersion: reviewVersion(pending, approvals, filters) };
}
async function approve(body, actor) {
  if (actor?.role !== "admin") throw new AppError("Chỉ quản trị viên được duyệt phiếu kho.", 403);
  const data = parse(body);
  const { note, ...filters } = data;
  if (data.status === "approved") throw new AppError("Đang lọc phiếu đã duyệt. Hãy chọn Tất cả hoặc Chờ duyệt để duyệt phiếu.");
  return runInventory(async (session) => {
    const pending = await Movement.find(movementFilter(filters, "pending")).select("-items.saleSnapshot").session(session).lean();
    const previous = await InventoryApproval.find(data.date ? { date: new Date(data.date) } : {}).session(session).lean();
    if (reviewVersion(pending, previous, filters) !== body.reviewVersion) throw new AppError("Danh sách phiếu hoặc lần duyệt đã thay đổi. Hãy tải lại trang, kiểm tra rồi duyệt lại.", 409);
    const days = [...new Set(pending.map((row) => new Date(row.date).toISOString().slice(0, 10)))];
    for (const day of days) approvalDate(day);
    const batchId = randomUUID(), now = new Date();
    const ids = pending.map((row) => row._id);
    try {
      for (const day of days) {
        await InventoryApproval.findOneAndUpdate({ date: new Date(day) }, {
          $set: { date: new Date(day), note, reviewedBy: actor._id, reviewedAt: now, batchId }
        }, { upsert: true, new: true, runValidators: true, session });
      }
      if (ids.length) {
        const result = await Movement.updateMany({ _id: { $in: ids }, approvalStatus: "pending" }, {
          $set: { requiresApproval: true, approvalStatus: "approved", approvedBy: actor._id, approvedAt: now, approvalBatch: batchId }
        }, { session });
        if (result.modifiedCount !== ids.length) throw new AppError("Danh sách phiếu đã thay đổi trong lúc duyệt. Hãy tải lại trang để kiểm tra.", 409);
      }
      return { ...filters, approvedCount: ids.length };
    } catch (error) {
      if (!session) {
        // Standalone MongoDB: undo only writes belonging to this approval attempt.
        if (ids.length) await Movement.bulkWrite(pending.map((row) => ({ updateOne: {
          filter: { _id: row._id, approvalBatch: batchId }, update: { $set: {
            requiresApproval: row.requiresApproval ?? true, approvalStatus: "pending", approvedBy: row.approvedBy ?? null,
            approvedAt: row.approvedAt ?? null, approvalBatch: row.approvalBatch ?? null, updatedAt: row.updatedAt
          } }, timestamps: false
        } })));
        for (const day of days) {
          const filter = { date: new Date(day), batchId };
          const old = previous.find((row) => new Date(row.date).toISOString().slice(0, 10) === day);
          if (old) await InventoryApproval.collection.replaceOne(filter, old);
          else await InventoryApproval.deleteOne(filter);
        }
      }
      throw error;
    }
  });
}
module.exports = { getReview, approve, parse, reviewVersion };
