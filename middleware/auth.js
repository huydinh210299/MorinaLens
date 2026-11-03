const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function attachUser(req, res, next) {
  req.user = null;
  try {
    const token = req.cookies[process.env.COOKIE_NAME || "morina_lens_token"];
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findOne({ _id: payload.userId, active: true }).lean();
    }
    res.locals.currentUser = req.user;
    next();
  } catch (error) { res.locals.currentUser = null; next(); }
}
function requireAuth(req, res, next) { if (!req.user) return res.redirect("/auth/login"); next(); }
function adminOnly(req, res, next) {
  if (!req.user) return res.redirect("/auth/login");
  if (req.user.role !== "admin") return res.redirect("/dashboard?error=" + encodeURIComponent("Bạn không có quyền thực hiện thao tác này."));
  next();
}
module.exports = { attachUser, requireAuth, adminOnly };
