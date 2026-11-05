require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const Configuration = require("../models/Configuration");
const { defaults, systemDefaults } = require("../utils/configuration");
const { backfillAutomaticPayroll } = require("../services/userService");
const { migratePricingConfiguration } = require("../services/configurationService");

async function seed() {
  const username = process.env.ADMIN_USERNAME?.trim();
  if (!username) throw new Error("Cần ADMIN_USERNAME để seed admin.");
  const existing = await User.findOne({ username });
  if (existing && existing.role !== "admin") throw new Error("ADMIN_USERNAME đang thuộc tài khoản nhân viên.");
  if (!existing) {
    if (!process.env.ADMIN_PASSWORD) throw new Error("Cần ADMIN_PASSWORD để tạo admin.");
    const password = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await User.create({ username, password, role: "admin", active: true });
    console.log("Đã tạo tài khoản admin ban đầu.");
  }
  for (const [key, label, value, unit] of defaults) {
    await Configuration.updateOne({ platform: "shopee", key }, { $setOnInsert: { platform: "shopee", key, label, value, unit } }, { upsert: true });
  }
  for (const [key, label, value, unit] of systemDefaults) {
    await Configuration.updateOne({ platform: "system", key }, { $setOnInsert: { platform: "system", key, label, value, unit } }, { upsert: true });
  }
  await migratePricingConfiguration();
  const updatedStaff = await backfillAutomaticPayroll();
  console.log(`Đã kiểm tra admin, 10 cấu hình Shopee, đơn giá mỗi đơn và lương tự động cho ${updatedStaff} nhân viên.`);
}
if (require.main === module) connectDB().then(seed).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
module.exports = seed;
