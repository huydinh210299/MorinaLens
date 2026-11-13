const service = require("../services/dailyClosingService");

async function index(req, res) {
  res.render("pages/inventory/closing", { title: "Chốt ngày và quảng cáo", ...await service.getDay(req.query) });
}
async function close(req, res) {
  const result = await service.close(req.body, req.user);
  const query = new URLSearchParams({ date: result.date, message: `Đã lưu chi phí quảng cáo và duyệt ${result.approvedCount} phiếu kho.` });
  res.redirect("/inventory/closing?" + query);
}
module.exports = { index, close };
