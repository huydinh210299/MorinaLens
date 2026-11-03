const AppError = require("./errors");

const text = (value, label, max = 150) => {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) throw new AppError(`${label} phải có từ 1 đến ${max} ký tự.`);
  return result;
};
const optionalText = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const number = (value, label, { min = 0, max = 1e12, integer = false } = {}) => {
  if (value === "" || value === undefined || value === null) throw new AppError(`${label} không được để trống.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new AppError(`${label} phải là số ${integer ? "nguyên " : ""}từ ${min} đến ${max}.`);
  }
  return parsed;
};
const optionalNumber = (value, label, options) => value === "" || value === undefined || value === null ? null : number(value, label, options);
const date = (value, label = "Ngày") => {
  const result = new Date(value);
  if (!value || Number.isNaN(result.getTime())) throw new AppError(`${label} không hợp lệ.`);
  return result;
};
const month = (value) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? ""))) throw new AppError("Tháng lương phải có dạng YYYY-MM.");
  return String(value);
};
const page = (value) => Math.max(1, Math.min(100000, parseInt(value, 10) || 1));
module.exports = { text, optionalText, number, optionalNumber, date, month, page };
