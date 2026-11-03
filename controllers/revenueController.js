const input = require("../utils/input");
const revenueService = require("../services/revenueService");

function currentMonthBangkok() {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", timeZone: "Asia/Bangkok" }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}`;
}
async function index(req, res) {
  const month = input.month(req.query.month || currentMonthBangkok());
  const report = await revenueService.getMonthlyReport(month);
  res.render("pages/revenue/index", { title: "Doanh thu và lợi nhuận", month, report });
}
module.exports = { index };
