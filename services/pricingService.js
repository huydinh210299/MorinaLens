const Configuration = require("../models/Configuration");
const { keys } = require("../utils/configuration");
const { calculate: calculateLegacy } = require("./legacyPricingService");
const PRICING_VERSION = 2;

async function getConfig(platform = "shopee", session = null) {
  const rows = await Configuration.find({ platform }).session(session).lean();
  if (platform === "tiktok" && rows.length === 0) return null;
  const result = Object.fromEntries(Object.entries(keys).map(([key, meta]) => [key, platform === "shopee" ? meta.defaultValue : null]));
  for (const row of rows) result[row.key] = row.value;
  return result;
}

function calculate(price, purchasePrice, config, adsOverride = null, version = PRICING_VERSION) {
  if (version === 1) return calculateLegacy(price, purchasePrice, config, adsOverride);
  if (price === null || price === undefined || !hasCompleteConfig(config)) return null;
  const rates = Object.fromEntries(["tax", "transactionFee", "fixedFee", "voucherExtra", "ads", "risk"].map((key) => [key, config[key] / 100]));
  if (adsOverride !== null) rates.ads = adsOverride / 100;
  const shopVoucher = Math.min(price, config.shopVoucher);
  const sale = price - shopVoucher;
  // Làm tròn từng khoản như bảng chi tiết Shopee, không làm tròn tổng tỷ lệ.
  const transactionFee = Math.round(sale * rates.transactionFee);
  const fixedFee = Math.round(sale * rates.fixedFee);
  const voucherExtra = Math.round(sale * rates.voucherExtra);
  const platformFee = transactionFee + fixedFee + voucherExtra + config.infrastructureFee + config.piShip;
  // Mức 1,5% gồm hai khoản khấu trừ độc lập: GTGT 1% và TNCN 0,5%.
  const tax = config.tax === 1.5 ? Math.round(sale * 0.01) + Math.round(sale * 0.005) : Math.round(sale * rates.tax);
  const estimatedPayout = sale - platformFee - tax;
  const adsBase = Math.max(0, estimatedPayout);
  const ads = adsBase * rates.ads;
  const risk = sale * rates.risk;
  const cost = purchasePrice + platformFee + ads + tax + config.packaging + risk;
  // Giá hòa vốn là ước tính liên tục; làm tròn phí có thể chênh vài đồng.
  const netRate = 1 - rates.transactionFee - rates.fixedFee - rates.voucherExtra - rates.tax;
  const contributionRate = netRate * (1 - rates.ads) - rates.risk;
  const fixedFees = config.infrastructureFee + config.piShip;
  const fixedCost = purchasePrice + fixedFees * (1 - rates.ads) + config.packaging;
  const breakEvenSale = contributionRate > 0 ? fixedCost / contributionRate : null;
  const breakEvenPrice = breakEvenSale === null ? null : breakEvenSale + config.shopVoucher;
  return { sale, shopVoucher, transactionFee, fixedFee, voucherExtra, platformFee, estimatedPayout, adsBase,
    ads, adsPercent: rates.ads * 100, tax, risk, cost, profit: sale - cost, breakEvenPrice };
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
module.exports = { getConfig, calculate, calculateProduct, calculateLegacy, hasCompleteConfig, effectiveAdsPercent, PRICING_VERSION };
