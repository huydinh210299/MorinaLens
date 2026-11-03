const AppError = require("../utils/errors");
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function notFound(req, res, next) { next(new AppError("Không tìm thấy trang.", 404)); }
function handle(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || (error.name === "CastError" ? 404 : 500);
  const message = status < 500 ? error.message : "Đã có lỗi hệ thống. Vui lòng thử lại.";
  if (status >= 500) console.error(error);
  if (status < 500 && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const back = req.get("referer");
    if (back) {
      try {
        const url = new URL(back);
        if (url.host === req.get("host")) {
          url.searchParams.set("error", message);
          return res.redirect(303, url.pathname + url.search);
        }
      } catch (_) { /* use error page */ }
    }
  }
  res.status(status).render("pages/error", { title: "Lỗi", message });
}
module.exports = { wrap, notFound, handle };
