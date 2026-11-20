const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
  shopeeAds: { type: Number, required: true, min: 0, max: 1e12, validate: Number.isSafeInteger },
  tiktokAds: { type: Number, required: true, min: 0, max: 1e12, validate: Number.isSafeInteger },
  note: { type: String, trim: true, default: "", maxlength: 500 },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  closedAt: { type: Date, required: true },
  requestId: { type: String, required: true, unique: true }
}, { timestamps: true });

module.exports = mongoose.model("MonthlyAdsClosing", schema);
