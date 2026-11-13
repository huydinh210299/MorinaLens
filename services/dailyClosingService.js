const { createHash, randomUUID } = require("node:crypto");
const Movement = require("../models/ImportAndExport");
const DailyClosing = require("../models/DailyClosing");
const AppError = require("../utils/errors");
const input = require("../utils/input");
const { today, parseDay, dayRange } = require("../utils/businessDate");
const { runInventory } = require("./inventoryService");

function reviewVersion(pending, closing) {
  const rows = pending.map((row) => [String(row._id), row.updatedAt, row.type, row.date, row.platform, row.items, row.note, row.createdBy?._id || row.createdBy]);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return createHash("sha256").update(JSON.stringify({ rows, closing: closing ? [String(closing._id), closing.batchId, closing.updatedAt] : null })).digest("hex");
}
function closingDate(value) {
  const date = parseDay(value);
  if (date.toISOString().slice(0, 10) > today()) throw new AppError("Không thể chốt ngày trong tương lai.");
  return date;
}
function parse(body) {
  const date = closingDate(body.date);
  const ads = (key, label) => {
    if (!["number", "string"].includes(typeof body[key]) || String(body[key]).trim() === "") throw new AppError(`Cần nhập ${label}; nhập 0 nếu không chạy quảng cáo.`);
    return input.number(body[key], label, { min: 0, integer: true });
  };
  const note = String(body.note ?? "").trim();
  if (note.length > 500) throw new AppError("Ghi chú không được dài quá 500 ký tự.");
  if (!/^[a-f0-9]{64}$/.test(String(body.reviewVersion || ""))) throw new AppError("Hãy tải lại trang chốt ngày trước khi duyệt.");
  return { date, shopeeAds: ads("shopeeAds", "tiền Ads Shopee"), tiktokAds: ads("tiktokAds", "tiền Ads TikTok"), note };
}
async function getDay(query = {}) {
  const date = closingDate(query.date || today());
  const [movements, closing] = await Promise.all([
    Movement.find({ date: dayRange(date.toISOString().slice(0, 10)) }).populate("createdBy", "username").sort({ createdAt: 1, _id: 1 }).lean(),
    DailyClosing.findOne({ date }).populate("closedBy", "username").lean()
  ]);
  const pending = movements.filter((row) => row.approvalStatus === "pending");
  const limit = 20, total = pending.length;
  const page = Math.min(input.page(query.page), Math.max(1, Math.ceil(total / limit)));
  return { date: date.toISOString().slice(0, 10), today: today(), closing, total, page, limit,
    items: pending.slice((page - 1) * limit, page * limit),
    approvedCount: movements.filter((row) => row.approvalStatus === "approved").length,
    counts: Object.fromEntries(["import", "export", "return"].map((type) => [type, pending.filter((row) => row.type === type).length])),
    reviewVersion: reviewVersion(pending, closing) };
}
async function close(body, actor) {
  if (actor?.role !== "admin") throw new AppError("Chỉ quản trị viên được chốt ngày và ghi chi phí quảng cáo.", 403);
  const data = parse(body);
  return runInventory(async (session) => {
    const pending = await Movement.find({ date: dayRange(body.date), approvalStatus: "pending" }).session(session).lean();
    const previous = await DailyClosing.findOne({ date: data.date }).session(session).lean();
    if (reviewVersion(pending, previous) !== body.reviewVersion) throw new AppError("Phiếu kho hoặc chi phí ngày này đã thay đổi. Hãy tải lại trang, kiểm tra rồi chốt lại.", 409);
    const batchId = randomUUID(), now = new Date();
    const ids = pending.map((row) => row._id);
    try {
      await DailyClosing.findOneAndUpdate({ date: data.date }, { $set: { ...data, closedBy: actor._id, closedAt: now, batchId } }, { upsert: true, new: true, runValidators: true, session });
      if (ids.length) {
        const result = await Movement.updateMany({ _id: { $in: ids }, approvalStatus: "pending" }, {
          $set: { requiresApproval: true, approvalStatus: "approved", approvedBy: actor._id, approvedAt: now, approvalBatch: batchId }
        }, { session });
        if (result.modifiedCount !== ids.length) throw new AppError("Danh sách phiếu đã thay đổi trong lúc duyệt. Hãy tải lại trang để kiểm tra.", 409);
      }
      return { date: body.date, approvedCount: ids.length };
    } catch (error) {
      if (!session) {
        // Standalone MongoDB: undo only writes belonging to this closing attempt.
        if (ids.length) await Movement.bulkWrite(pending.map((row) => ({ updateOne: {
          filter: { _id: row._id, approvalBatch: batchId }, update: { $set: {
            requiresApproval: row.requiresApproval ?? true, approvalStatus: "pending", approvedBy: row.approvedBy ?? null,
            approvedAt: row.approvedAt ?? null, approvalBatch: row.approvalBatch ?? null, updatedAt: row.updatedAt
          } }, timestamps: false
        } })));
        if (previous) await DailyClosing.collection.replaceOne({ date: data.date, batchId }, previous);
        else await DailyClosing.deleteOne({ date: data.date, batchId });
      }
      throw error;
    }
  });
}
module.exports = { getDay, close, parse, reviewVersion };
