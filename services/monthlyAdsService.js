const { randomUUID } = require("node:crypto");
const MonthlyAdsClosing = require("../models/MonthlyAdsClosing");
const AppError = require("../utils/errors");
const input = require("../utils/input");
const { paginateRows } = require("../utils/pagination");
const { today } = require("../utils/businessDate");

function parse(body) {
  const month = input.month(body.month);
  if (month > today().slice(0, 7)) throw new AppError("Không thể chốt Ads cho tháng trong tương lai.");
  const ads = (key, label) => {
    if (!["number", "string"].includes(typeof body[key]) || String(body[key]).trim() === "") throw new AppError(`Cần nhập ${label}; nhập 0 nếu không chạy quảng cáo.`);
    return input.number(body[key], label, { min: 0, integer: true });
  };
  const note = String(body.note ?? "").trim();
  if (note.length > 500) throw new AppError("Ghi chú không được dài quá 500 ký tự.");
  const requestId = String(body.requestId || "");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) throw new AppError("Hãy tải lại trang chốt Ads trước khi lưu.");
  return { month, shopeeAds: ads("shopeeAds", "tiền Ads Shopee"), tiktokAds: ads("tiktokAds", "tiền Ads TikTok"), note, requestId };
}
async function getMonth(query = {}) {
  const month = input.month(query.month || today().slice(0, 7));
  const entries = await MonthlyAdsClosing.find({ month }).populate("closedBy", "username").sort({ closedAt: -1, _id: -1 }).lean();
  const totals = { shopeeAds: 0, tiktokAds: 0 };
  for (const entry of entries) {
    totals.shopeeAds += entry.shopeeAds;
    totals.tiktokAds += entry.tiktokAds;
  }
  const { items, ...pagination } = paginateRows(entries, query.page);
  return { ...pagination, month, currentMonth: today().slice(0, 7), entries: items, totals, requestId: randomUUID() };
}
async function close(body, actor) {
  if (actor?.role !== "admin") throw new AppError("Chỉ quản trị viên được chốt chi phí quảng cáo.", 403);
  const data = parse(body);
  try {
    await MonthlyAdsClosing.create({ ...data, closedBy: actor._id, closedAt: new Date() });
    return { month: data.month, alreadySaved: false };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const previous = await MonthlyAdsClosing.findOne({ requestId: data.requestId }).lean();
    if (!previous || String(previous.closedBy) !== String(actor._id) ||
        ["month", "shopeeAds", "tiktokAds", "note"].some((key) => previous[key] !== data[key])) {
      throw new AppError("Lần chốt này đã được lưu với nội dung khác. Hãy tải lại trang để chốt khoản mới.", 409);
    }
    return { month: data.month, alreadySaved: true };
  }
}
module.exports = { getMonth, close, parse };
