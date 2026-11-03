const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const AppError = require("../utils/errors");

function loginPage(req, res) { if (req.user) return res.redirect("/dashboard"); res.render("pages/auth/login", { title: "Đăng nhập" }); }
async function login(req, res) {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = await User.findOne({ username, active: true }).select("+password");
  if (!user || !(await bcrypt.compare(password, user.password))) throw new AppError("Tên đăng nhập hoặc mật khẩu không đúng.", 401);
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "1d" });
  res.cookie(process.env.COOKIE_NAME || "morina_lens_token", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 86400000 });
  res.redirect("/dashboard");
}
function logout(req, res) { res.clearCookie(process.env.COOKIE_NAME || "morina_lens_token"); res.redirect("/auth/login"); }
module.exports = { loginPage, login, logout };
