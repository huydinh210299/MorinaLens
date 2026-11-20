const service = require("../services/monthlyAdsService");

async function index(req, res) {
  res.render("pages/inventory/ads", { title: "Chốt Ads theo tháng", ...await service.getMonth(req.query) });
}
async function close(req, res) {
  const result = await service.close(req.body, req.user);
  const message = result.alreadySaved ? "Khoản Ads này đã được lưu trước đó, không cộng trùng." : "Đã cộng khoản Ads vào tháng " + result.month + ".";
  res.redirect("/inventory/ads?" + new URLSearchParams({ month: result.month, message }));
}
module.exports = { index, close };
