const mongoose = require("mongoose");
const adsSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  percentOverride: { type: Number, default: null, min: 0, max: 100 }
}, { _id: false });
const schema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0, default: 0 },
  purchasePrice: { type: Number, required: true, min: 0 },
  shopeePrice: { type: Number, default: null, min: 0 },
  tiktokPrice: { type: Number, default: null, min: 0 },
  ads: {
    shopee: { type: adsSchema, default: () => ({}) },
    tiktok: { type: adsSchema, default: () => ({}) }
  },
  note: { type: String, default: "" }
}, { timestamps: true });
module.exports = mongoose.model("Product", schema);
