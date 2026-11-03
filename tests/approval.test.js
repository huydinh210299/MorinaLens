const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/User");
const { applyMovementOrder } = require("../services/inventoryService");

test("chỉ phiếu xuất đã duyệt cộng đúng một đơn và tính lại lương", () => {
  const user = new User({ username: "staff", password: "hash", orders: [], payroll: [{ month: "2026-11", ratePerOrder: 3000, amount: 0 }] });
  const movement = { _id: new mongoose.Types.ObjectId(), requiresApproval: true, approvalStatus: "pending", type: "export", date: new Date("2026-11-03") };
  assert.equal(applyMovementOrder(user, movement), false);
  assert.equal(user.orders.length, 0);
  movement.approvalStatus = "approved";
  assert.equal(applyMovementOrder(user, movement), true);
  assert.equal(user.orders.length, 1);
  assert.equal(user.orders[0].amount, 1);
  assert.equal(user.payroll[0].amount, 3000);
  applyMovementOrder(user, movement);
  assert.equal(user.orders.length, 1);
  movement.type = "return";
  applyMovementOrder(user, movement);
  assert.equal(user.orders.length, 0);
  assert.equal(user.payroll[0].amount, 0);
});
test("duyệt phiếu hoàn không cộng hoặc trừ đơn", () => {
  const user = new User({ username: "staff", password: "hash", orders: [], payroll: [] });
  const movement = { _id: new mongoose.Types.ObjectId(), requiresApproval: true, approvalStatus: "approved", type: "return", date: new Date("2026-11-03") };
  assert.equal(applyMovementOrder(user, movement), false);
  assert.equal(user.orders.length, 0);
});
test("duyệt phiếu xuất tự tạo lương tháng khi chưa có bảng lương", () => {
  const user = new User({ username: "staff-auto", password: "hash", orders: [], payroll: [] });
  const movement = { _id: new mongoose.Types.ObjectId(), requiresApproval: true, approvalStatus: "approved", type: "export", date: new Date("2026-11-03") };
  assert.equal(applyMovementOrder(user, movement, false, 1500), true);
  assert.equal(user.payroll[0].orderCount, 1);
  assert.equal(user.payroll[0].ratePerOrder, 1500);
  assert.equal(user.payroll[0].amount, 1500);
});
test("đổi ngày phiếu xuất đã duyệt chuyển công sang tháng mới", () => {
  const user = new User({ username: "staff", password: "hash", payroll: [
    { month: "2026-11", ratePerOrder: 3000, amount: 0 },
    { month: "2026-12", ratePerOrder: 4000, amount: 0 }
  ] });
  const movement = { _id: new mongoose.Types.ObjectId(), requiresApproval: true, approvalStatus: "approved", type: "export", date: new Date("2026-11-03") };
  applyMovementOrder(user, movement);
  movement.date = new Date("2026-12-02");
  applyMovementOrder(user, movement);
  assert.equal(user.orders.length, 1);
  assert.equal(user.payroll.find((row) => row.month === "2026-11").amount, 0);
  assert.equal(user.payroll.find((row) => row.month === "2026-12").amount, 4000);
});
