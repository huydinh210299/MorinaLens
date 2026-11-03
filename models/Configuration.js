const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  platform: { type: String, required: true, enum: ["shopee", "tiktok", "system"] },
  key: { type: String, required: true },
  label: { type: String, required: true },
  value: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true, enum: ["percent", "vnd"] }
}, { timestamps: true });
schema.index({ platform: 1, key: 1 }, { unique: true });
module.exports = mongoose.model("Configuration", schema);
