const AppError = require("./errors");

function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" }).format(now);
}
function parseDay(value) {
  const day = String(value ?? "");
  const date = new Date(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new AppError("Ngày không hợp lệ.");
  }
  return date;
}
function dayRange(day) {
  const start = parseDay(day);
  return { $gte: start, $lt: new Date(start.getTime() + 86400000) };
}
module.exports = { today, parseDay, dayRange };
