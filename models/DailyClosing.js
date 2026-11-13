const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  date: { type: Date, required: true, unique: true },
  shopeeAds: { type: Number, required: true, min: 0, max: 1e12, validate: Number.isSafeInteger },
  tiktokAds: { type: Number, required: true, min: 0, max: 1e12, validate: Number.isSafeInteger },
  note: { type: String, trim: true, default: "", maxlength: 500 },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  closedAt: { type: Date, required: true },
  batchId: { type: String, required: true }
}, { timestamps: true });
module.exports = mongoose.model("DailyClosing", schema);
