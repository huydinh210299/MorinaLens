const Configuration = require("../models/Configuration");
const { keys, systemKeys } = require("../utils/configuration");
const { refreshDefaultPayrollRate } = require("../services/userService");
const input = require("../utils/input");
const AppError = require("../utils/errors");
async function index(req, res) {
  const rows = await Configuration.find().sort({ platform: 1, key: 1 }).lean();
  res.render("pages/configuration/index", { title: "Cấu hình", rows, keys, systemKeys });
}
async function update(req, res) {
  const platform = req.params.platform, key = req.params.key;
  const meta = platform === "system" ? systemKeys[key] : ["shopee", "tiktok"].includes(platform) ? keys[key] : null;
  if (!meta) throw new AppError("Cấu hình không hợp lệ.", 404);
  const value = input.number(req.body.value, meta.label, { min: 0, max: meta.unit === "percent" ? 100 : 1e9, integer: platform === "system" });
  await Configuration.updateOne({ platform, key }, { $set: { value, label: meta.label, unit: meta.unit } }, { upsert: true, runValidators: true });
  if (platform === "system" && key === "ratePerOrder") await refreshDefaultPayrollRate(value);
  res.redirect("/configuration?message=" + encodeURIComponent("Đã lưu cấu hình."));
}
module.exports = { index, update };
