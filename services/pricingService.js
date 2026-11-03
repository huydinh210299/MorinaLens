const Configuration = require("../models/Configuration");
const { keys } = require("../utils/configuration");

async function getConfig(platform = "shopee") {
  const rows = await Configuration.find({ platform }).lean();
  if (platform === "tiktok" && rows.length === 0) return null;
  const result = Object.fromEntries(Object.entries(keys).map(([key, meta]) => [key, platform === "shopee" ? meta.defaultValue : null]));
  for (const row of rows) result[row.key] = row.value;
  return result;
}

function calculate(price, purchasePrice, config, adsOverride = null) {
  if (price === null || price === undefined || !hasCompleteConfig(config)) return null;
  const rates = Object.fromEntries(["tax", "transactionFee", "fixedFee", "voucherExtra", "ads", "risk", "shopVoucher"].map((key) => [key, config[key] / 100]));
  if (adsOverride !== null) rates.ads = adsOverride / 100;
  const sale = price * (1 - rates.shopVoucher) * (1 + rates.tax);
  const platformFee = sale * (rates.transactionFee + rates.fixedFee + rates.voucherExtra) + config.infrastructureFee + config.piShip;
  const ads = sale * rates.ads;
  const tax = (sale - platformFee) * rates.tax;
  const risk = sale * rates.risk;
  const cost = purchasePrice + platformFee + ads + tax + config.packaging + risk;
  const contributionRate = 1 - (rates.transactionFee + rates.fixedFee + rates.voucherExtra) - rates.ads - rates.risk - (1 - rates.transactionFee - rates.fixedFee - rates.voucherExtra) * rates.tax;
  const fixedCost = purchasePrice + (config.infrastructureFee + config.piShip) * (1 - rates.tax) + config.packaging;
  const breakEvenSale = contributionRate > 0 ? fixedCost / contributionRate : null;
  const breakEvenPrice = breakEvenSale === null || rates.shopVoucher >= 1 ? null : breakEvenSale / ((1 - rates.shopVoucher) * (1 + rates.tax));
  return { sale, platformFee, ads, adsPercent: rates.ads * 100, tax, risk, cost, profit: sale - cost, breakEvenPrice };
}

function hasCompleteConfig(config) {
  return !!config && Object.keys(keys).every((key) => Number.isFinite(config[key]));
}
function effectiveAdsPercent(product, config, platform = "shopee") {
  const settings = product.ads?.[platform];
  if (settings?.enabled === false) return 0;
  if (settings?.percentOverride !== null && settings?.percentOverride !== undefined) return settings.percentOverride;
  return config?.ads ?? null;
}
function calculateProduct(product, config, platform = "shopee") {
  const price = platform === "shopee" ? product.shopeePrice : product.tiktokPrice;
  return calculate(price, product.purchasePrice, config, effectiveAdsPercent(product, config, platform));
}
module.exports = { getConfig, calculate, calculateProduct, hasCompleteConfig, effectiveAdsPercent };
