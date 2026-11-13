const mongoose = require("mongoose");
const { keys } = require("../utils/configuration");
const configSnapshotSchema = new mongoose.Schema(Object.fromEntries(
  Object.entries(keys).map(([key, meta]) => [key, {
    type: Number, required: true, min: 0, ...(meta.unit === "percent" ? { max: 100 } : {})
  }])
), { _id: false });
const saleSnapshotSchema = new mongoose.Schema({
  pricingVersion: { type: Number, enum: [1, 2], default: 1 },
  listPrice: { type: Number, required: true, min: 0 },
  purchasePrice: { type: Number, default: null, min: 0 },
  config: { type: configSnapshotSchema, default: null },
  unitRevenue: { type: Number, required: true },
  unitCost: { type: Number, required: true },
  unitCostBeforeAds: { type: Number, default: null },
  unitProfit: { type: Number, required: true },
  unitAdsCost: { type: Number, default: null, min: 0 },
  adsPercentApplied: { type: Number, required: true, min: 0, max: 100 }
}, { _id: false });
const itemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  sku: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  saleSnapshot: { type: saleSnapshotSchema, default: null }
}, { _id: false });
const schema = new mongoose.Schema({
  type: { type: String, required: true, enum: ["import", "export", "return"] },
  date: { type: Date, required: true },
  platform: { type: String, enum: ["shopee", "tiktok"], default: "shopee" },
  items: { type: [itemSchema], validate: [(items) => items.length > 0, "Cần ít nhất một sản phẩm."] },
  note: { type: String, default: "" },
  source: { type: String, enum: ["form", "product_update"], default: "form" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  requiresApproval: { type: Boolean, default: true },
  approvalStatus: { type: String, enum: ["pending", "approved"], default: "pending" },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null },
  approvalBatch: { type: String, default: null }
}, { timestamps: true });
module.exports = mongoose.model("ImportAndExport", schema);
