const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  description: { type: String, required: true },
  status: { type: String, enum: ["running", "completed", "failed"], required: true },
  startedAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },
  error: { type: String, default: null },
  result: { type: mongoose.Schema.Types.Mixed, default: null }
}, { collection: "migrations", versionKey: false });

module.exports = mongoose.model("Migration", schema);
