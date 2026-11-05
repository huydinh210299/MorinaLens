const defaults = [
  ["tax", "Thuế", 1.5, "percent"],
  ["transactionFee", "Phí xử lý giao dịch", 6, "percent"],
  ["fixedFee", "Phí cố định", 16.5, "percent"],
  ["voucherExtra", "Phí voucher extra", 5.5, "percent"],
  ["infrastructureFee", "Phí hạ tầng", 3000, "vnd"],
  ["piShip", "Pi ship", 0, "vnd"],
  ["ads", "Ads", 15, "percent"],
  ["packaging", "Đóng gói", 2500, "vnd"],
  ["risk", "Chi phí rủi ro", 1.5, "percent"],
  ["shopVoucher", "Voucher shop", 0, "vnd"]
];
const keys = Object.fromEntries(defaults.map(([key, label, value, unit]) => [key, { label, unit, defaultValue: value }]));
const systemDefaults = [["ratePerOrder", "Đơn giá mỗi đơn", 1500, "vnd"]];
const systemKeys = Object.fromEntries(systemDefaults.map(([key, label, value, unit]) => [key, { label, unit, defaultValue: value }]));
module.exports = { defaults, keys, systemDefaults, systemKeys };
