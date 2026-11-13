const mongoose = require("mongoose");
const orderSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  amount: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  movement: { type: mongoose.Schema.Types.ObjectId, ref: "ImportAndExport", default: null },
  attendance: { type: Boolean, default: false },
  approved: { type: Boolean, default: true },
  note: { type: String, default: "", trim: true, maxlength: 500 },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null }
}, { timestamps: true });
const payrollPaymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, required: true, enum: ["auto", "manual"] },
  orderCountAtPayment: { type: Number, required: true, min: 0 },
  ratePerOrderAtPayment: { type: Number, default: null, min: 0 },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  paidAt: { type: Date, required: true }
}, { timestamps: true });
const payrollSchema = new mongoose.Schema({
  month: { type: String, required: true },
  orderCount: { type: Number, required: true, min: 0, default: 0 },
  ratePerOrder: { type: Number, default: null, min: 0 },
  usesDefaultRate: { type: Boolean, default: false },
  amount: { type: Number, required: true, min: 0 },
  payments: { type: [payrollPaymentSchema], default: [] },
  note: { type: String, default: "" }
}, { timestamps: true });
const commissionSchema = new mongoose.Schema({
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  revenue: { type: Number, required: true, min: 0 },
  percent: { type: Number, required: true, min: 0, max: 100 },
  amount: { type: Number, required: true, min: 0 },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  closedAt: { type: Date, required: true }
}, { timestamps: true });
const schema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ["admin", "staff"], default: "staff" },
  active: { type: Boolean, default: true },
  orders: { type: [orderSchema], default: [] },
  payroll: { type: [payrollSchema], default: [] },
  commissions: { type: [commissionSchema], default: [] }
}, { timestamps: true });
module.exports = mongoose.model("User", schema);
