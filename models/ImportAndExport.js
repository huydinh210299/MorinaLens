const mongoose = require("mongoose");
const saleSnapshotSchema = new mongoose.Schema({
  listPrice: { type: Number, required: true, min: 0 },
  unitRevenue: { type: Number, required: true },
  unitCost: { type: Number, required: true },
  unitProfit: { type: Number, required: true },
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
  requiresApproval: { type: Boolean, default: false },
  approvalStatus: { type: String, enum: ["pending", "approved"], default: "approved" },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null }
}, { timestamps: true });
module.exports = mongoose.model("ImportAndExport", schema);
