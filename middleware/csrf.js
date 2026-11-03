const crypto = require("crypto");
const AppError = require("../utils/errors");
function csrf(req, res, next) {
  let token = req.cookies.morina_lens_csrf;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = crypto.randomBytes(32).toString("hex");
    res.cookie("morina_lens_csrf", token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  }
  res.locals.csrfToken = token;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const submitted = String(req.body?._csrf || "");
    if (!/^[a-f0-9]{64}$/.test(submitted) || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(submitted))) {
      return next(new AppError("Phiên biểu mẫu đã hết hạn. Hãy tải lại trang rồi thử lại.", 403));
    }
  }
  next();
}
module.exports = csrf;
