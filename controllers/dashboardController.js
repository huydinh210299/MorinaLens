const Product = require("../models/Product");
const Movement = require("../models/ImportAndExport");
const User = require("../models/User");

async function index(req, res) {
  const [products, outOfStock] = await Promise.all([
    Product.countDocuments(), Product.countDocuments({ quantity: 0 })
  ]);
  if (req.user.role !== "admin") {
    return res.render("pages/dashboard/index", { title: "Tổng quan", products, outOfStock });
  }
  const [pending, staff] = await Promise.all([
    Movement.countDocuments({ approvalStatus: "pending", platform: "shopee" }), User.countDocuments({ role: "staff", active: true })
  ]);
  res.render("pages/dashboard/index", { title: "Tổng quan", products, outOfStock, pending, staff });
}
module.exports = { index };
