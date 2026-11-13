const service = require("../services/timekeepingService");

function redirect(res, path, month, message) {
  res.redirect(`${path}?` + new URLSearchParams({ month, message }));
}
async function index(req, res) {
  res.render("pages/users/timekeeping", { title: "Chấm công của tôi", ...await service.ownData(req.user._id, req.query) });
}
async function save(req, res) {
  const month = await service.saveOwn(req.user._id, req.body, req.params.entryId);
  redirect(res, "/users/timekeeping", month, "Đã gửi chấm công, vui lòng chờ quản trị viên duyệt.");
}
async function cancel(req, res) {
  const month = await service.cancelOwn(req.user._id, req.params.entryId);
  redirect(res, "/users/timekeeping", month, "Đã hủy chấm công chờ duyệt.");
}
async function pending(req, res) {
  res.render("pages/users/pending-timekeeping", { title: "Duyệt chấm công", ...await service.pendingData(req.query) });
}
async function approve(req, res) {
  const month = await service.review(req.params.userId, req.params.entryId, req.user, true);
  redirect(res, "/users/timekeeping/pending", month, "Đã duyệt chấm công và cập nhật lương theo số đơn.");
}
async function reject(req, res) {
  const month = await service.review(req.params.userId, req.params.entryId, req.user, false);
  redirect(res, "/users/timekeeping/pending", month, "Đã từ chối và xóa chấm công chờ duyệt. Nhân viên có thể gửi lại.");
}
module.exports = { index, save, cancel, pending, approve, reject };
