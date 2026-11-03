const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/User");
const { countOrders, recalculatePayroll, paidTotal } = require("../services/userService");

test("lương theo đơn được tính lại khi số đơn trong tháng thay đổi", () => {
  const user = new User({ username: "staff", password: "hash", orders: [
    { date: new Date("2026-11-02"), amount: 4 },
    { date: new Date("2026-11-03"), amount: 3 },
    { date: new Date("2026-10-31"), amount: 5 }
  ], payroll: [{ month: "2026-11", ratePerOrder: 2000, amount: 0 }] });
  assert.equal(countOrders(user, "2026-11"), 7);
  recalculatePayroll(user, "2026-11");
  assert.equal(user.payroll[0].orderCount, 7);
  assert.equal(user.payroll[0].amount, 14000);
  user.orders.shift();
  recalculatePayroll(user, "2026-11");
  assert.equal(user.payroll[0].orderCount, 3);
  assert.equal(user.payroll[0].amount, 6000);
});
test("lương thủ công giữ nguyên số tiền khi cập nhật số đơn", () => {
  const user = new User({ username: "staff", password: "hash", orders: [{ date: new Date("2026-11-02"), amount: 2 }], payroll: [{ month: "2026-11", ratePerOrder: null, amount: 500000 }] });
  recalculatePayroll(user, "2026-11");
  assert.equal(user.payroll[0].orderCount, 2);
  assert.equal(user.payroll[0].amount, 500000);
});

test("tự tạo lương theo cấu hình cho staff đã có đơn, đổi đơn giá cập nhật lương tự động", () => {
  const user = new User({ username: "staff-auto", password: "hash", role: "staff", orders: [
    { date: new Date("2026-11-03"), amount: 1 },
    { date: new Date("2026-11-04"), amount: 1 }
  ] });
  recalculatePayroll(user, "2026-11", 1500);
  assert.equal(user.payroll.length, 1);
  assert.equal(user.payroll[0].usesDefaultRate, true);
  assert.equal(user.payroll[0].orderCount, 2);
  assert.equal(user.payroll[0].amount, 3000);
  recalculatePayroll(user, "2026-11", 2000);
  assert.equal(user.payroll[0].ratePerOrder, 2000);
  assert.equal(user.payroll[0].amount, 4000);
});

test("lương tạm tính tăng sau thanh toán nhưng khoản đã trả giữ nguyên", () => {
  const user = new User({ username: "staff-paid", password: "hash", role: "staff", orders: [
    { date: new Date("2026-11-03"), amount: 2 }
  ] });
  recalculatePayroll(user, "2026-11", 1500);
  user.payroll[0].payments.push({ amount: 3000, method: "auto", orderCountAtPayment: 2,
    ratePerOrderAtPayment: 1500, paidBy: user._id, paidAt: new Date("2026-11-04") });
  user.orders.push({ date: new Date("2026-11-05"), amount: 1 });
  recalculatePayroll(user, "2026-11", 1500);
  assert.equal(user.payroll[0].amount, 4500);
  assert.equal(paidTotal(user.payroll[0]), 3000);
});
