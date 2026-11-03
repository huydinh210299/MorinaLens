require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Product = require("../models/Product");

const legacyFields = ["platformPrices", "f1", "f2", "f3", "sellingPrices", "adsEnabled", "adsPercentOverride"];
const legacyFilter = { $or: legacyFields.map((field) => ({ [field]: { $exists: true } })) };
const validPrice = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

async function migrate() {
  const collection = Product.collection;
  const products = await collection.find(legacyFilter).toArray();
  if (products.length === 0) {
    console.log("Không có sản phẩm cần chuyển giá.");
    return;
  }
  const backupDir = path.join(__dirname, "..", "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const backup = path.join(backupDir, `products-before-single-price-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(backup, JSON.stringify(products, null, 2), { mode: 0o600, flag: "wx" });
  console.log(`Đã sao lưu ${products.length} sản phẩm: ${backup}`);

  let missingShopee = 0;
  for (const product of products) {
    const oldShopee = product.platformPrices?.shopee?.f1 ?? product.f1;
    const oldTiktok = product.platformPrices?.tiktok?.f1;
    const shopeePrice = validPrice(product.shopeePrice) ? product.shopeePrice : validPrice(oldShopee) ? oldShopee : null;
    const tiktokPrice = validPrice(product.tiktokPrice) ? product.tiktokPrice : validPrice(oldTiktok) ? oldTiktok : null;
    if (shopeePrice === null) missingShopee++;
    const ads = {
      shopee: product.ads?.shopee ?? { enabled: true, percentOverride: null },
      tiktok: product.ads?.tiktok ?? { enabled: false, percentOverride: null }
    };
    await collection.updateOne({ _id: product._id }, {
      $set: { shopeePrice, tiktokPrice, ads },
      $unset: Object.fromEntries(legacyFields.map((field) => [field, ""]))
    });
  }
  console.log(`Đã chuyển ${products.length} sản phẩm sang shopeePrice/tiktokPrice; ${missingShopee} sản phẩm không có F1 Shopee để chuyển. Giá F2/F3 chỉ được giữ trong bản sao lưu.`);
}

if (require.main === module) connectDB().then(migrate).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
module.exports = { migrate, legacyFilter };
