const Product = require("../models/Product");
const Movement = require("../models/ImportAndExport");
const User = require("../models/User");
const { getConfig, hasCompleteConfig } = require("../services/pricingService");

async function index(req, res) {
  const [products, lowStock, movements] = await Promise.all([
    Product.countDocuments(), Product.countDocuments({ quantity: { $lte: 5 } }), Movement.countDocuments()
  ]);
  if (req.user.role !== "admin") {
    const current = await User.findById(req.user._id).lean();
    const thisMonth = new Date().toISOString().slice(0, 7);
    const ordersThisMonth = (current.orders || []).filter((row) => new Date(row.date).toISOString().slice(0, 7) === thisMonth).reduce((sum, row) => sum + row.amount, 0);
    return res.render("pages/dashboard/index", { title: "Tổng quan", products, lowStock, movements, ordersThisMonth });
  }
  const [pending, staff, tiktok] = await Promise.all([
    Movement.countDocuments({ approvalStatus: "pending" }), User.countDocuments({ role: "staff", active: true }), getConfig("tiktok")
  ]);
  res.render("pages/dashboard/index", { title: "Tổng quan", products, lowStock, movements, pending, staff, tiktok, tiktokReady: hasCompleteConfig(tiktok) });
}
module.exports = { index };
