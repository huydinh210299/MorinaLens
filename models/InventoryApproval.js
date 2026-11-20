const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  date: { type: Date, required: true, unique: true },
  note: { type: String, trim: true, default: "", maxlength: 500 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reviewedAt: { type: Date, required: true },
  batchId: { type: String, required: true }
}, { timestamps: true });
module.exports = mongoose.model("InventoryApproval", schema);
