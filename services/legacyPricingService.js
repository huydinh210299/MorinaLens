// Công thức phiên bản 1 chỉ dùng để đối chiếu hoặc di trú snapshot lịch sử.
const { keys } = require("../utils/configuration");

function calculate(price, purchasePrice, config, adsOverride = null) {
  if (price === null || price === undefined || !hasCompleteConfig(config)) return null;
  const rates = Object.fromEntries(["tax", "transactionFee", "fixedFee", "voucherExtra", "ads", "risk", "shopVoucher"].map((key) => [key, config[key] / 100]));
  if (adsOverride !== null) rates.ads = adsOverride / 100;
  // Giá bán đã gồm thuế; thuế chỉ được trừ một lần trong chi phí.
  const sale = price * (1 - rates.shopVoucher);
  const platformFee = sale * (rates.transactionFee + rates.fixedFee + rates.voucherExtra) + config.infrastructureFee + config.piShip;
  const ads = sale * rates.ads;
  const tax = (sale - platformFee) * rates.tax;
  const risk = sale * rates.risk;
  const cost = purchasePrice + platformFee + ads + tax + config.packaging + risk;
  const contributionRate = 1 - (rates.transactionFee + rates.fixedFee + rates.voucherExtra) - rates.ads - rates.risk - (1 - rates.transactionFee - rates.fixedFee - rates.voucherExtra) * rates.tax;
  const fixedCost = purchasePrice + (config.infrastructureFee + config.piShip) * (1 - rates.tax) + config.packaging;
  const breakEvenSale = contributionRate > 0 ? fixedCost / contributionRate : null;
  const breakEvenPrice = breakEvenSale === null || rates.shopVoucher >= 1 ? null : breakEvenSale / (1 - rates.shopVoucher);
  return { sale, platformFee, ads, adsPercent: rates.ads * 100, tax, risk, cost, profit: sale - cost, breakEvenPrice };
}

function hasCompleteConfig(config) {
  return !!config && Object.keys(keys).every((key) => Number.isFinite(config[key]));
}
module.exports = { calculate };

