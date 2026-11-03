const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");
const Movement = require("../models/ImportAndExport");
const Product = require("../models/Product");
const pricing = require("../services/pricingService");

const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;

function recalculateSnapshot(snapshot, fallback = {}) {
  if (!snapshot || !Number.isFinite(snapshot.listPrice) || !Number.isFinite(snapshot.adsPercentApplied)) return null;
  const config = snapshot.config ?? fallback.config;
  const purchasePrice = snapshot.purchasePrice ?? fallback.purchasePrice;
  if (!pricing.hasCompleteConfig(config) || !Number.isFinite(purchasePrice)) return null;
  const result = pricing.calculate(snapshot.listPrice, purchasePrice, config, snapshot.adsPercentApplied);
  const matches = (value) => close(snapshot.unitRevenue, value.sale) && close(snapshot.unitCost, value.cost) && close(snapshot.unitProfit, value.profit);
  if (matches(result)) return null; // Đã dùng công thức mới: chạy lại không đổi dữ liệu.
  // Chỉ chấp nhận đầu vào tái hiện đúng cả 3 kết quả của công thức cũ.
  // Đặc biệt, không gán cấu hình hiện tại vào lịch sử nếu không đối chiếu được.
  const oldResult = pricing.calculate(snapshot.listPrice * (1 + config.tax / 100), purchasePrice, config, snapshot.adsPercentApplied);
  if (!matches(oldResult)) return null;
  return { ...snapshot, purchasePrice, config: { ...config },
    unitRevenue: result.sale, unitCost: result.cost, unitProfit: result.profit };
}

async function main() {
  require("dotenv").config();
  const uri = new URL(process.env.MONGODB_URI);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname) || uri.pathname !== "/morina-lens") {
    throw new Error("Script chỉ cập nhật database morina-lens trên MongoDB local.");
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const movements = await Movement.collection.find({ type: "export", source: { $ne: "product_update" } }).toArray();
  const products = new Map((await Product.find().lean()).map((product) => [String(product._id), product]));
  const configs = { shopee: await pricing.getConfig("shopee"), tiktok: await pricing.getConfig("tiktok") };
  const changes = [];
  let changedItems = 0;
  let revenueChange = 0;
  let profitChange = 0;
  for (const movement of movements) {
    const fields = {};
    for (const [index, item] of movement.items.entries()) {
      const snapshot = recalculateSnapshot(item.saleSnapshot, {
        config: configs[movement.platform || "shopee"], purchasePrice: products.get(String(item.product))?.purchasePrice
      });
      if (!snapshot) continue;
      fields[`items.${index}.saleSnapshot`] = snapshot;
      changedItems += 1;
      revenueChange += (snapshot.unitRevenue - item.saleSnapshot.unitRevenue) * item.amount;
      profitChange += (snapshot.unitProfit - item.saleSnapshot.unitProfit) * item.amount;
    }
    if (Object.keys(fields).length) changes.push({ movement, fields });
  }
  const apply = process.argv.includes("--apply");
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", database: mongoose.connection.name,
    scannedMovements: movements.length, changedMovements: changes.length, changedItems, revenueChange, profitChange }));
  if (!apply || !changes.length) return;

  const backupDir = path.join(__dirname, "..", "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const backup = path.join(backupDir, `sales-before-tax-inclusive-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(backup, mongoose.mongo.BSON.EJSON.stringify(changes.map(({ movement }) => movement), null, 2, { relaxed: false }), { flag: "wx" });
  console.log(`Backup: ${backup}`);
  for (const { movement, fields } of changes) {
    // Không ghi đè nếu một thao tác khác đã sửa các dòng hàng từ lúc đọc.
    const result = await Movement.collection.updateOne({ _id: movement._id, items: movement.items }, { $set: fields });
    if (result.modifiedCount !== 1) throw new Error(`Phiếu ${movement._id} đã thay đổi; dừng cập nhật.`);
    const saved = await Movement.collection.findOne({ _id: movement._id });
    for (const [field, expected] of Object.entries(fields)) {
      const actual = saved.items[Number(field.split(".")[1])].saleSnapshot;
      if (!close(actual.unitRevenue, expected.unitRevenue) || !close(actual.unitCost, expected.unitCost) || !close(actual.unitProfit, expected.unitProfit)) {
        throw new Error(`Không xác minh được kết quả phiếu ${movement._id}.`);
      }
    }
  }
  console.log(`Đã cập nhật và xác minh ${changes.length} phiếu, ${changedItems} dòng hàng.`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}
module.exports = { recalculateSnapshot };
